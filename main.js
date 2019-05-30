#!/usr/bin/env node

const { ArgumentParser } = require('argparse')
const compareRomAddresses = require('./src/hex-match.js')
const compareScoobyRomTables = require('./src/table-match.js')
const config = require('./config')
const convert = require('xml-js')
const fs = require('fs')

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
