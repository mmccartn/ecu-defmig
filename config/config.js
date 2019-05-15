#!/usr/bin/env node

const nconf = require('nconf')
const path = require('path')

class Config {
    constructor() {
        nconf.argv().env()
        const env = nconf.get('NODE_ENV') || 'dev'
        nconf.file(env, path.join('config', `${env.toLowerCase()}.json`))
        nconf.file('default', path.join('config', 'default.json'))
        nconf.set('app:env', env)
    }

    get(key) {
        return nconf.get(key)
    }
}

module.exports = new Config()
