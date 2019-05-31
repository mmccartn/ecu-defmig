#!/usr/bin/env node

const LENGTH_LIMIT = 1024

const padHex = function(str) {
    return str[0] === '0' && str[1] === 'x' ? str : `0x${str}`
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
const indexOfSingle = function(buf, value) {
    const offset = buf.indexOf(value)
    if (offset === -1) {
        return -1
    } else if (buf.indexOf(value, value.length + offset) === -1) {
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
        return { match: index + (key - start), len, offset: key - start }
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

module.exports = function(rrRomTable, srcBin, targetBin) {
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
        if (window && window.match > -1) {
            const targetAddr = window.match
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
