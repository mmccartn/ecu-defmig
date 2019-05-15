#!/usr/bin/env node

const { ArgumentParser } = require('argparse')
const config = require('./config')
const convert = require('xml-js')
const fs = require('fs')

const TABLE_IGNORES = new Set(['name', 'storageaddress'])
const SCALE_IGNORES = new Set()

const trimHex = function(str) {
    return str[0] === '0' && str[1] === 'x' ? str.substring(2) : str
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
        const matches = targetRom.table.filter((tTable, index) => {
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

const main = function(args) {
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
        }
        return targets
    }, [])

    const targetOut = {
        _declaration: rrDefs._declaration,
        _comment: rrDefs._comment,
        roms: {
            rom: [
                {
                    attr: rrRom.attr,
                    romid: targetRom.romid,
                    table: targetTables
                },
                rrDefs.roms.rom[1]
            ]
        }
    }
    writeXml(targetOut, args.target)
    console.info('Matched and saved', targetTables.length, 'definitions to', args.target)
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
        ['--target'], { help: 'Target RomRaider XML definitions to generate', defaultValue: './data/RR_EA1M511A.xml' }
    )
    parser.addArgument(
        ['--target-sr'], { help: 'Target ScoobyRom RomRaider XML maps', defaultValue: './data/SR-RR_EA1M511A.xml' }
    )
    const args = parser.parseArgs()
    console.info(`=== ${config.get('app:name')} ===`)
    main(args)
    console.info('~~~ END')
}
