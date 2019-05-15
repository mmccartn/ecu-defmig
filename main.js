#!/usr/bin/env node

const { ArgumentParser } = require('argparse')
const config = require('./config')
const parser = require('fast-xml-parser')
const fs = require('fs')

const TABLE_IGNORES = new Set(['name', 'storageaddress'])
const SCALE_IGNORES = new Set()

const trimHex = function(str) {
    return str[0] === '0' && str[1] === 'x' ? str.substring(2) : str
}

const comparesRTables = function(tableA, tableB) {
    if (compareElements(tableA, tableB, TABLE_IGNORES)) {
        if (compareElements(tableA.scaling, tableB.scaling, SCALE_IGNORES)) {
            const subTablesA = tableA.table
            const subTablesB = tableB.table
            if (!subTablesA && !subTablesB) {
                return true
            } else if ((subTablesA && !subTablesB) || (!subTablesA && subTablesB)) {
                return false
            } else if ((subTablesA && subTablesB) && subTablesA.length !== subTablesB.length) {
                return false
            } else if (!subTablesA.length && !subTablesB.length) {
                return comparesRTables(subTablesA, subTablesB)
            } else {
                for (let idx in subTablesA) {
                    if (!comparesRTables(subTablesA[idx], subTablesB[idx])) {
                        return false
                    }
                }
                return true
            }
        } else {
            return false
        }
    } else {
        return false
    }
}

const compareElements = function(elementA, elementB, ignore) {
    for (let attr of Object.keys(elementA.attr)) {
        if (!ignore.has(attr) && elementB.attr[attr] !== elementA.attr[attr]) {
            return false
        }
    }
    return true
}

// Not Used
const compareObjects = function(objA, objB, ignore) {
    for (let key of Object.keys(objA)) {
        if (!ignore.has(key) && objB[key] !== objA[key]) {
            return false
        }
    }
    return true
}

const test = function(args) {
    const rrRom = readFirstRom(args.source)
    const srRom = readFirstRom(args.source_sr)
    const srcMap = mapRrToSr(rrRom, srRom)

    const targetRom = readFirstRom(args.target_sr)

    // const test = comparesRTables(srRom.table[srcMap[4]], targetRom.table[1287])
    // console.info(rrRom.table[4], srRom.table[srcMap[4]], targetRom.table[1287])
    // console.info(test)
    // return

    Object.keys(srcMap).forEach(srcIdx => {
        // TODO: find all tables in targetSrRom that match table and srRom.table[srcMap[idx]]
        const table = rrRom.table[srcIdx]
        const srTable = srRom.table[srcMap[srcIdx]]
        const matches = targetRom.table.filter((tTable, index) => {
            return comparesRTables(srTable, tTable)
        })
        if (matches.length === 0) {
            console.warn('No matches found for', table.attr.name)
        } else if (matches.length === 1) {
            console.warn('Matched', table.attr.name, 'to', matches[0].attr.storageaddress)
        } else {
            // console.info(table.attr.name, matches.length)
        }
    })
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

const readFirstRom = function(filepath) {
    const xmlStr = fs.readFileSync(filepath, { encoding: 'UTF-8' })
    const defs = parser.parse(xmlStr, {
        attributeNamePrefix : '',
        attrNodeName: 'attr',
        ignoreAttributes: false
    })
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
    const main = () => {
        console.info(`=== ${config.get('app:name')} ===`)
        test(args)
        console.info('~~~ END')
    }
    main()
}

// source:      data/RR_EA1T400W.xml
// source-sr:   data/SR-RR_EA1T400W.xml
// target:      data/RR_EA1M511A.xml
// target-sr:   data/SR-RR_EA1M511A.xml

// Mine: EA1M511A
// His:  EA1T400W
