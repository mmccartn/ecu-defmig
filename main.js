#!/usr/bin/env node

const { ArgumentParser } = require('argparse')
const config = require('./config')
const convert = require('xml-js')
const fs = require('fs')

const LENGTH_LIMIT = 4096
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
    if (clone.table && clone.table.length) {
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

const oldMain = function(args) {
    const rrDefs = readXml(args.source)
    const rrRom = readFirstRom(rrDefs)
    const srRom = readFirstRom(readXml(args.source_sr))
    const srcMap = mapRrToSr(rrRom, srRom)
    const targetRom = readFirstRom(readXml(args.target_sr))

    const results = matchSourceToTarget(rrRom, srRom, srcMap, targetRom)

    const targetTables = results.reduce((targets, result) => {
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

    writeXml(constructRom(rrDefs, rrRom, targetRom, targetTables), args.target)
    console.info('Matched and saved', targetTables.length, 'definitions to', args.target)
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

const indexOfAll = function(buf, value, start = 0) {
    const matches = []
    let offset = buf.indexOf(value, start)
    while (offset !== -1) {
        matches.push(offset)
        offset = buf.indexOf(value, offset + value.length + start)
    }
    return matches
}

const matchBins = function(addr, srcBin, targetBin, offset = 0) {
    const addrInt = parseInt(padHex(addr))
    let result = { matches: [], len: LENGTH_LIMIT }
    let index = -2
    for (let len = 0; len < LENGTH_LIMIT; len++) {
        const mapVals = readBytes(srcBin, addrInt, len)
        index = indexOfSingle(targetBin, mapVals, offset)
        if (index === -1) {
            const targetMatches = indexOfAll(targetBin, readBytes(srcBin, addrInt, len - 1), offset)
            console.warn(
                `Multiple matchs found from 0x${addr}+${len - 1}`,
                `[${targetMatches.length}]`
            )
            result = { matches: targetMatches, len: len - 1 }
            break
        } else if (index !== -2) {
            console.info(`Matched 0x${addr} to 0x${index.toString(16)}+${len}`)
            result = { matches: [index], len }
            break
        }
    }
    return result
}

const main = function(args) {
    const rrDefs = readXml(args.source)
    const rrRom = readFirstRom(rrDefs)

    const srcBin = fs.readFileSync(args.source_rom)
    const targetBin = fs.readFileSync(args.target_rom)

    const matchMap = rrRom.table.reduce((acc, table) => {
        const rootAddr = table.attr.storageaddress
        acc[rootAddr] = matchBins(rootAddr, srcBin, targetBin)
        if (acc[rootAddr].matches.length === 1) {
            const lastIndex = acc[rootAddr].matches[0]
            if (table.table && table.table.length) {
                table.table.forEach(subTable => {
                    const subAddr = subTable.attr.storageaddress
                    acc[subAddr] = matchBins(subAddr, srcBin, targetBin, lastIndex)
                })
            } else if (table.table) {
                const subAddr = table.table.attr.storageaddress
                acc[subAddr] = matchBins(subAddr, srcBin, targetBin, lastIndex)
            }
        }
        return acc
    }, {})

    const targetTables = rrRom.table.reduce((acc, table) => {
        const targetTable = { ...table }
        const srcAddr = table.attr.storageaddress
        const match = matchMap[srcAddr]
        if (match.matches.length === 1) {
            const targetAddr = match.matches[0]
            targetTable.attr.storageaddress = targetAddr.toString(16).toUpperCase()
            if (targetTable.table) {
                targetTable.table = targetTable.table.length ? targetTable.table : [targetTable.table]
                targetTable.table.forEach(subTable => {
                    const subAddr = subTable.attr.storageaddress
                    const subMatch = matchMap[subAddr]
                    if (match.matches.length === 1) {
                        const subTargetAddr = subMatch.matches[0]
                        subTable.attr.storageaddress = subTargetAddr.toString(16).toUpperCase()
                    } else {
                        subTable.attr.storageaddress = '0x00'
                    }
                })
            }
            acc.push(targetTable)
        }
        return acc
    }, [])

    writeXml(constructRom(rrDefs, rrRom, targetTables), args.target)
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
        ['--source-rom'], { help: 'Source binary ROM file', defaultValue: './roms/EA1T400W.bin' }
    )
    parser.addArgument(
        ['--target-rom'], { help: 'Target binary ROM file', defaultValue: './roms/EA1M511A.bin' }
    )
    parser.addArgument(
        ['--target'], { help: 'Target RomRaider XML definitions', defaultValue: './data/RR_EA1M511A.xml' }
    )
    const args = parser.parseArgs()
    console.info(`=== ${config.get('app:name')} ===`)
    main(args)
    console.info('~~~ END')
}
