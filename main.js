#!/usr/bin/env node

const { ArgumentParser } = require('argparse')
const config = require('./config')
const convert = require('xml-js')
const fs = require('fs')

const LENGTH_LIMIT = 1024
const TABLE_IGNORES = new Set(['name', 'storageaddress'])
const SCALE_IGNORES = new Set()

const trimHex = function(str) {
    return str[0] === '0' && str[1] === 'x' ? str.substring(2) : str
}

const padHex = function(str) {
    return str[0] === '0' && str[1] === 'x' ? str : `0x${str}`
}

const compareSrTables = function(tableA, tableB) {
    if (
        tableA._comment === tableB._comment &&
        compareElements(tableA, tableB, TABLE_IGNORES) &&
        compareElements(tableA.scaling, tableB.scaling, SCALE_IGNORES)
    ) {
        const subTablesA = tableA.table
        const subTablesB = tableB.table
        if (!subTablesA && !subTablesB) { // Neither has sub-tables
            return true
        } else if ( // Missmatch
            ((subTablesA && !subTablesB) || (!subTablesA && subTablesB)) ||
            ((subTablesA && subTablesB) && subTablesA.length !== subTablesB.length)
        ) {
            return false
        } else if (!subTablesA.length && !subTablesB.length) { // Both are objects
            return compareSrTables(subTablesA, subTablesB)
        } else { // Both have arrays of sub-tables
            for (let idx in subTablesA) {
                if (!compareSrTables(subTablesA[idx], subTablesB[idx])) {
                    return false
                }
            }
            return true
        }
    }
    return false
}

const compareElements = function(elementA, elementB, ignore) {
    for (let attr of Object.keys(elementA.attr)) {
        if (!ignore.has(attr) && elementB.attr[attr] !== elementA.attr[attr]) {
            return false
        }
    }
    return true
}

const mapRrToSr = function(rrRom, srRom) {
    return rrRom.table.reduce((lookup, table, idx) => {
        const storeAddr = trimHex(table.attr.storageaddress)
        const match = srRom.table.findIndex(entry => {
            return trimHex(entry.attr.storageaddress) === storeAddr
        })
        if (match !== -1) {
            lookup[idx] = match
        }
        return lookup
    }, {})
}

const matchSourceToTarget = function(rrRom, srRom, srcMap, targetRom) {
    return Object.keys(srcMap).reduce((results, srcIdx) => {
        const table = rrRom.table[srcIdx]
        const srTable = srRom.table[srcMap[srcIdx]]
        const matches = targetRom.table.filter(tTable => {
            return compareSrTables(srTable, tTable)
        })
        results.push({ table, matches })
        return results
    }, [])
}

const mergeTables = function(tableA, tableB) {
    const clone = { ...tableA }
    clone.attr.storageaddress = trimHex(tableB.attr.storageaddress)
    if (clone.table && tableB.table) {
        clone.table = clone.table.length ? clone.table : [clone.table]
        tableB.table = tableB.table.length ? tableB.table : [tableB.table]
        for (let idx in clone.table) {
            clone.table[idx] = mergeTables(clone.table[idx], tableB.table[idx])
        }
    }
    return clone
}

const matchMultipleByOrder = function(srRom, srcMap, rrRom, rrTable, matches) {
    const srTable = srRom.table[srcMap[rrRom.table.indexOf(rrTable)]]
    const srcOrder = srRom.table.filter(table => {
        return compareSrTables(srTable, table)
    })
    if (matches.length === srcOrder.length) {
        return matches[
            srcOrder.map(match => trimHex(match.attr.storageaddress))
                .indexOf(rrTable.attr.storageaddress)
        ]
    } else {
        return false
    }
}

const constructRom = function(rrDefs, rrRom, targetTables) {
    return {
        _declaration: rrDefs._declaration,
        _comment: rrDefs._comment,
        roms: {
            rom: [
                {
                    attr: rrRom.attr,
                    romid: rrRom.romid,
                    table: targetTables
                },
                rrDefs.roms.rom[1]
            ]
        }
    }
}

const writeXml = function(obj, filepath) {
    const xmlStr = convert.js2xml(obj, { attributesKey: 'attr', spaces: 2, compact: true })
    fs.writeFileSync(filepath, xmlStr.replace(/"\/>/g, '" />'), { encoding: 'UTF-8' })
}

const readXml = function(filepath) {
    const xmlStr = fs.readFileSync(filepath, { encoding: 'UTF-8' })
    return convert.xml2js(xmlStr, { attributesKey: 'attr', compact: true })
}

const readFirstRom = function(defs) {
    return defs.roms.rom.length ? defs.roms.rom[0] : defs.roms.rom
}

const compareScoobyRomTables = function(rrRom, srRom, targetRom) {
    const srcMap = mapRrToSr(rrRom, srRom)
    const results = matchSourceToTarget(rrRom, srRom, srcMap, targetRom)

    return results.reduce((targets, result) => {
        if (result.matches.length === 1) {
            targets.push(mergeTables(result.table, result.matches[0]))
        } else if (result.matches.length === 1) {
            console.error('No matches found for', result.table.attr.name)
        } else {
            console.warn('Multiple matches for', result.table.attr.name,
                result.matches.map(match => match.attr.storageaddress))
            const match = matchMultipleByOrder(srRom, srcMap, rrRom, result.table, result.matches)
            if (match) {
                targets.push(mergeTables(result.table, match))
            } else {
                console.warn('* Could not find matching table from multiple choice by order')
            }
        }
        return targets
    }, [])
}

const readBytes = function(buf, offset, numBytes) {
    if ((offset + numBytes) > buf.length) {
        throw RangeError
    }
    const value = Buffer.alloc(numBytes)
    for (let idx = 0; idx < numBytes; idx++) {
        value[idx] = buf[offset + idx]
    }
    return value
}

// Returns:
// -1: value not found in buf
// -2: value found at least 2 times in buf
// 0+: index of value in buf
const indexOfSingle = function(buf, value, start = 0) {
    const offset = buf.indexOf(value, start)
    if (offset === -1) {
        return -1
    } else if (buf.indexOf(value, value.length + offset + start) === -1) {
        return offset
    } else {
        return -2
    }
}

const shortestUniqueWindow = function(key, start, len, bufA, bufB, tried, limit = LENGTH_LIMIT) {
    const word = readBytes(bufA, start, len)
    tried.add(`${start},${len}`)
    const index = indexOfSingle(bufB, word)
    if (index === -1) { // found no match
        return { match: -1, len: Infinity, offset: 0 }
    } else if (index !== -2) { // found unique match
        return { match: index + (key - start), len, offset: (key - start) }
    } else if (len >= limit) { // search depth limit
        return { match: -4, len, offset: 0 }
    } else { // found match, but not unique
        let best = { match: -3, len: Infinity, offset: 0 }
        if (!tried.has(`${start - 1},${len + 1}`)) { // bwd
            const win = shortestUniqueWindow(key, start - 1, len + 1, bufA, bufB, tried, limit)
            best = win.match > -1 ? win : best
        }
        if (!tried.has(`${start - 0},${len + 1}`)) { // fwd
            const win = shortestUniqueWindow(key, start - 0, len + 1, bufA, bufB, tried, Math.min(limit, best.len))
            best = win.match > -1 && win.len < best.len ? win : best
        }
        if (!tried.has(`${start - 1},${len + 2}`)) { // bid
            const win = shortestUniqueWindow(key, start - 1, len + 2, bufA, bufB, tried, Math.min(limit, best.len))
            best = win.match > -1 && win.len < best.len ? win : best
        }
        return best
    }
}

const shortestUniqueWindowHelper = function(table, bufA, bufB, verbose = true) {
    const addr = table.attr.storageaddress
    const addrInt = parseInt(padHex(addr))
    const window = shortestUniqueWindow(addrInt, addrInt, 1, bufA, bufB, new Set())
    if (verbose) {
        console.info( // DEBUG
            'Matched:',
            `(0x${addr}, 0x${window.match.toString(16).toUpperCase()}) -`,
            `[${window.offset}:${window.len}:${window.len - window.offset}]`
        )
    }
    return window
}

const matchSubTables = function(rootTable, matchMap, bufA, bufB) {
    const tables = rootTable.length ? rootTable : [rootTable]
    for (let table of tables) {
        matchMap[table.attr.storageaddress] = shortestUniqueWindowHelper(table, bufA, bufB)
    }
}

const main = function(args) {
    const rrDefs = readXml(args.source)
    const rrRom = readFirstRom(rrDefs)
    const srRom = readFirstRom(readXml(args.source_sr))
    const targetRom = readFirstRom(readXml(args.target_sr))

    const targetTablesA = compareScoobyRomTables(rrRom, srRom, targetRom)

    const rrRomTableUnk = rrRom.table.filter(table => {
        return !targetTablesA.find(targetTable => {
            return targetTable.attr.name === table.attr.name
        })
    })

    const srcBin = fs.readFileSync(args.source_rom)
    const targetBin = fs.readFileSync(args.target_rom)
    const targetTablesB = compareRomAddresses(rrRomTableUnk, srcBin, targetBin)

    const targetTables = [...targetTablesA, ...targetTablesB]
    const targetTablesOrdered = rrRom.table.reduce((tables, srcTable) => {
        const target = targetTables.find(target => target.attr.name === srcTable.attr.name)
        if (target) {
            tables.push(target)
        }
        return tables
    }, [])
    console.info('Wrote', targetTablesOrdered.length, 'definitions to', args.target)
    writeXml(constructRom(rrDefs, rrRom, targetTablesOrdered), args.target)
}

const compareRomAddresses = function(rrRomTable, srcBin, targetBin) {
    // Find the shortest unique matching address range in the target bin for all
    // known source address
    const matchMap = {}
    for (let table of rrRomTable) {
        const window = shortestUniqueWindowHelper(table, srcBin, targetBin)
        matchMap[table.attr.storageaddress] = window
        if (window.match > -1 && table.table) {
            matchSubTables(table.table, matchMap, srcBin, targetBin)
        }
    }
    return rrRomTable.reduce((acc, table) => {
        const targetTable = { ...table }
        const srcAddr = table.attr.storageaddress
        const window = matchMap[srcAddr]
        const targetAddr = window.match
        if (targetAddr > -1) {
            targetTable.attr.storageaddress = targetAddr.toString(16).toUpperCase()
            if (targetTable.table) {
                targetTable.table = targetTable.table.length ? targetTable.table : [targetTable.table]
                targetTable.table.forEach(subTable => {
                    const subSrcAddr = subTable.attr.storageaddress
                    subTable.attr.storageaddress = matchMap[subSrcAddr].match.toString(16).toUpperCase()
                })
            }
            acc.push(targetTable)
        }
        return acc
    }, [])
}

if (require.main === module) {
    const parser = new ArgumentParser({
        version: config.get('app:version'),
        addHelp: true,
        description: config.get('app:name')
    })
    parser.addArgument(
        ['--source'], { help: 'Source RomRaider XML definitions', defaultValue: './data/RR_EA1T400W.xml' }
    )
    parser.addArgument(
        ['--source-sr'], { help: 'Source ScoobyRom RomRaider XML maps', defaultValue: './data/SR-RR_EA1T400W.xml' }
    )
    parser.addArgument(
        ['--source-rom'], { help: 'Source binary ROM file', defaultValue: './roms/EA1T400W.bin' }
    )
    parser.addArgument(
        ['--target'], { help: 'Target RomRaider XML definitions', defaultValue: './data/RR_EA1M511A.xml' }
    )
    parser.addArgument(
        ['--target-sr'], { help: 'Target ScoobyRom RomRaider XML maps', defaultValue: './data/SR-RR_EA1M511A.xml' }
    )
    parser.addArgument(
        ['--target-rom'], { help: 'Target binary ROM file', defaultValue: './roms/EA1M511A.bin' }
    )
    const args = parser.parseArgs()
    console.info(`=== ${config.get('app:name')} ===`)
    main(args)
    console.info('~~~ END')
}
