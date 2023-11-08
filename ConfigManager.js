/**
 * @typedef {object} config
 * @property {string} GithubToken
 * @property {string} RepoOwner
 * @property {string} RepoName
 * @property {string} RepoBranch
 * @property {{ url: string, send: { plain: boolean, ping: boolean, errors: boolean, enabled: boolean }, pingMsg: string }[]} Webhooks
 * @property {number} Interval
 * @property {boolean} commitNewEndpoints
 * @property {string} commitNewEndpointsMsg
 * @property {{ id: string }} Misc
 */


const fs = require('fs');
const path = require('path');
const { parse } = require('comment-json');

/**
 * @type {config}
 */
const config = parse(fs.readFileSync(path.join(__dirname, './config.json')).toString());

class ConfigManager {
    /**
     * @returns {config}
     */
    static getConfig() {
        return config;
    }

    /**
     * @param {config} newConfig
     * @returns {void}
     */
    static setConfig(newConfig) {
        fs.writeFileSync(path.join(__dirname, './config.json'), JSON.stringify(newConfig, null, 4));
    }
}

module.exports = ConfigManager;