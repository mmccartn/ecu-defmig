#!/usr/bin/env node

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

module.exports = function(rrRom, srRom, targetRom) {
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
