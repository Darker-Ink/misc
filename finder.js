const options = {
    "indent_size": "4",
    "indent_char": " ",
    "max_preserve_newlines": "5",
    "preserve_newlines": true,
    "keep_array_indentation": false,
    "break_chained_methods": false,
    "indent_scripts": "normal",
    "brace_style": "collapse",
    "space_before_conditional": true,
    "unescape_strings": false,
    "jslint_happy": false,
    "end_with_newline": false,
    "wrap_line_length": "0",
    "indent_inner_html": false,
    "comma_first": false,
    "e4x": false,
    "indent_empty_lines": false
};

const { request } = require('undici');
const cheerio = require('cheerio');
const url = "https://canary.discord.com";
const lookingFor = require("./finders.json");
const { rename, writeFile, access, unlink } = require('fs/promises');
const js_beautify = require("js-beautify").js_beautify;

const RequestData = async () => {
    const { body } = await request(url + '/login');
    const text = await body.text();
    const $ = cheerio.load(text);

    return $;
};

/**
 * FileNames:
 * The first one is the new file name
 * The second one is for the old file name
 */
const findUrls = async () => {
    const $ = await RequestData();

    const scripts = $('body script');

    const srcs = scripts.map((_, el) => {
        return $(el).attr('src');
    }).get();

    const files = srcs.reverse();

    let foundUrls = [];
    let jsFiles = [];

    for (const file of files) {
        const { body } = await request(url + file);
        const text = await body.text();
        const moreJsFilesRegex = /[0-9a-f]{18,26}\.js/g;

        if (moreJsFilesRegex.test(text)) {
            const jsFile = text.match(moreJsFilesRegex).filter((x) => x.endsWith('.js'));

            jsFiles.push(...jsFile);
        }

        for (const look of lookingFor) {
            let matched = true;

            for (const thing of look.strings) {
                if (!text.includes(thing)) {
                    matched = false;
                    break;
                }
            }

            if (matched) {
                foundUrls.push({
                    name: look.name,
                    url: url + file,
                    fileNames: look.fileNames
                });
            }
        }
    }

    return foundUrls;
};

const FindAndDownloadThenSave = async (beautify = true) => {
    const foundUrls = await findUrls();

    for (const foundUrl of foundUrls) {
        const { body } = await request(foundUrl.url);
        const text = await body.text();

        if (beautify) {
            const beautified = js_beautify(text, options);

            await access(foundUrl.fileNames[0]).then(async () => {
                await unlink(foundUrl.fileNames[1]).catch(() => { });
                await rename(foundUrl.fileNames[0], foundUrl.fileNames[1]);
                await writeFile(foundUrl.fileNames[0], beautified);
            }).catch(async () => {
                await writeFile(foundUrl.fileNames[0], beautified);
                await writeFile(foundUrl.fileNames[1], beautified);
            });
        } else {
            await access(foundUrl.fileNames[0]).then(async () => {
                await unlink(foundUrl.fileNames[1]).catch(() => { });
                await rename(foundUrl.fileNames[0], foundUrl.fileNames[1]);
                await writeFile(foundUrl.fileNames[0], text);
            }).catch(async () => {
                await writeFile(foundUrl.fileNames[0], text);
                await writeFile(foundUrl.fileNames[1], text);
            });
        }
    }

    return foundUrls;
};


module.exports.findUrls = findUrls;
module.exports.FindAndDownloadThenSave = FindAndDownloadThenSave;