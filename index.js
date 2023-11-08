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
const js_beautify = require("js-beautify").js_beautify;
const dashAst = require("dash-ast");
const acorn = require("acorn");
const fs = require("fs");
const path = require("path");
const deepdiff = require('deep-diff');
const predictions = require("./predictions.json");
const WebhookUtils = require("./WebhookUtils.js");
const { FindAndDownloadThenSave } = require("./finder.js");

const read = (file = 'current.js') => {
    const currentJs = fs.readFileSync(path.join(__dirname, file), "utf8");

    const beautified = js_beautify(currentJs, options);

    const parsed = acorn.parse(beautified, {
        ecmaVersion: 2020,
    });

    const finishedData = [];

    dashAst(parsed, async (node, parent) => {
        if (node.type !== "Property") return;

        // we only want AssignmentExpression
        const found = node?.value?.body?.body?.filter((x) => x?.type === "ExpressionStatement").filter((x) => x.expression.expressions).map((x) => {

            const expressions = x.expression.expressions.filter((y) => y.type === "AssignmentExpression");
            const typeNames = x.expression.expressions.filter((y) => y.type === "CallExpression")
                .map((y) => y.arguments.filter((z) => z.type === "ObjectExpression")
                    .map((a) => a.properties.filter((b) => b.type === "Property")
                        .map((c) => c.key.name)))
                .flat(Infinity);

            return {
                expressions,
                typeNames
            };
        }).filter((x) => x.expressions.length > 0).map((x) => {
            if (!Array.isArray(x.expressions)) return;

            return x.expressions.map((y) => ({
                name: y?.left?.property?.left?.property?.name,
                value: y?.left?.property?.right?.value,
                possibleTypes: x.typeNames
            }));
        }).map((x) => {
            const end = x.filter((y) => Boolean(y.name));

            return end;
        });


        if (!found || !Array.isArray(found) || found.length === 0) return;

        const dataToSave = [];

        for (const item of found) {
            if (item.length === 0) continue;

            dataToSave.push(item);
        }

        if (dataToSave.length === 0) return;

        finishedData.push(dataToSave);
    });

    return finishedData;
};


const start = async () => {
    const fixed = await FindAndDownloadThenSave(true);

    for (const item of fixed) {
        const data = read(item.fileNames[0]);
        const data2 = read(item.fileNames[1]);

        const differences = deepdiff(data, data2);

        const endingDifferences = [];

        if (!differences || !Array.isArray(differences)) {
            console.log("No differences found");

            continue;
        }

        for (const difference of differences) {
            const test = data2[difference.path[0]][difference.path[1]];

            let matchedSoFar = 0;

            let matched;

            for (const prediction of predictions) {
                matchedSoFar = 0;

                for (const key of prediction.keys) {
                    const found = test.find((x) => x.name === key.name && x.value === key.value);

                    if (found) matchedSoFar++;

                    if (matchedSoFar === prediction.matchingRequired) {
                        matched = prediction;

                        break;
                    }
                }

                if (matched) break;
            }

            endingDifferences.push({
                value: difference.path[2] ? test[difference.path[2]] : test[difference.index] ? test[difference.index] : null,
                type: matched ? matched.type : "Unknown",
                matched,
                difference,
                action: difference.kind === "N" ? "Added" : difference.kind === "D" ? "Removed" : difference.kind === "E" ? "Changed" : "Unknown",
                old: difference.rhs ?? null,
                new: difference.lhs ?? null
            });
        }

        const newnewdata = [];

        endingDifferences.forEach((item, index, array) => {
            const isNameOrValuePath = item.difference.path.some(
                key => key === 'name' || key === 'value'
            );

            if (!isNameOrValuePath) {
                newnewdata.push({
                    first: item,
                    second: null
                });

                return true;
            }

            const otherItem = array.find(
                otherItem => otherItem.difference.path.slice(0, -1).join('.') === item.difference.path.slice(0, -1).join('.') && otherItem.difference.path[item.difference.path.length - 1] !== item.difference.path[item.difference.path.length - 1]
            );

            if (!otherItem) {
                newnewdata.push({
                    first: item,
                    second: null
                });

                return true;
            }

            const found = newnewdata.find((x) => x.first.difference.path.join('.') === otherItem.difference.path.join('.') || x.second?.difference.path.join('.') === otherItem.difference.path.join('.'));

            if (found) {
                return true;
            }

            newnewdata.push({
                first: item,
                second: otherItem
            });
        });

        const lastStupidThing = newnewdata.map((x) => {
            if (x.first && x.second && x.first.value === null && x.second.value === null) {
                return {
                    first: {
                        ...x.first,
                        value: {
                            newName: x.first.new,
                            newValue: x.second.new,
                            oldName: x.first.old,
                            oldValue: x.second.old
                        }
                    },
                    second: null
                };
            } else if (x.first && x.second === null) {
                console.log(x)

                return {
                    first: {
                        ...x.first,
                        value: {
                            newName: typeof x.first.new !== 'string' ? x.first.value?.name ? x.first.value.name : x.first.value?.value ? x.first.value.value : x.first.value : x.first.new,
                            newValue: x.first.new,
                            oldName: typeof x.first.old !== 'string' ? x.first.value?.name ? x.first.value.name : x.first.value?.value ? x.first.value.value : x.first.value : x.first.new,
                            oldValue: x.first.old,
                            raw: {
                                name: x.first.value.name,
                                value: x.first.value.value
                            }
                        }
                    },
                    second: null
                };
            }

            return x;
        });

        let message = ``;

        const channelTypes = lastStupidThing.filter((x) => x.first.type === "channelTypes");
        const messageTypes = lastStupidThing.filter((x) => x.first.type === "messageTypes");
        const messageFlags = lastStupidThing.filter((x) => x.first.type === "messageFlags");
        const statusTypes = lastStupidThing.filter((x) => x.first.type === "statusTypes");
        const errors = lastStupidThing.filter((x) => x.first.type === "errors");
        const userFlags = lastStupidThing.filter((x) => x.first.type === "userFlags");
        const unknown = lastStupidThing.filter((x) => x.first.type === "Unknown");

        if (channelTypes.length > 0) message += `# Channel Types Changed\n \`\`\`diff`;

        for (const item of channelTypes) {
            if (item.first.action === "Changed") {
                message += `\n- ${item.first.value.oldName} - ${item.first.value.oldValue}`;
                message += `\n+ ${item.first.value.newName} - ${item.first.value.newValue}`;
            } else {
                message += `\n${item.first.action === "Added" ? "+" : item.first.action === "Removed" ? "-" : "+"} ${item.first.value.newName ?? item.first.value.raw.name} - ${item.first.value.newValue ?? item.first.value.raw.value}`;
            }
        }

        if (channelTypes.length > 0) message += `\`\`\``;
        if (messageTypes.length > 0) message += `\n# Message Types Changed\n \`\`\`diff`;

        for (const item of messageTypes) {
            if (item.first.action === "Changed") {
                message += `\n- ${item.first.value.oldName} - ${item.first.value.oldValue}`;
                message += `\n+ ${item.first.value.newName} - ${item.first.value.newValue}`;
            } else {
                message += `\n${item.first.action === "Added" ? "+" : item.first.action === "Removed" ? "-" : "+"} ${item.first.value.newName ?? item.first.value.raw.name} - ${item.first.value.newValue ?? item.first.value.raw.value}`;
            }
        }

        if (messageTypes.length > 0) message += `\`\`\``;
        if (messageFlags.length > 0) message += `\n# Message Flags Changed\n \`\`\`diff`;

        for (const item of messageFlags) {
            if (item.first.action === "Changed") {
                message += `\n- ${item.first.value.oldName} - ${item.first.value.oldValue}`;
                message += `\n+ ${item.first.value.newName} - ${item.first.value.newValue}`;
            } else {
                message += `\n${item.first.action === "Added" ? "+" : item.first.action === "Removed" ? "-" : "+"} ${item.first.value.newName ?? item.first.value.raw.name} - ${item.first.value.newValue ?? item.first.value.raw.value}`;
            }
        }

        if (messageFlags.length > 0) message += `\`\`\``;
        if (statusTypes.length > 0) message += `\n# Status Types Changed\n \`\`\`diff`;

        for (const item of statusTypes) {
            if (item.first.action === "Changed") {
                message += `\n- ${item.first.value.oldName} - ${item.first.value.oldValue}`;
                message += `\n+ ${item.first.value.newName} - ${item.first.value.newValue}`;
            } else {
                message += `\n${item.first.action === "Added" ? "+" : item.first.action === "Removed" ? "-" : "+"} ${item.first.value.newName ?? item.first.value.raw.name} - ${item.first.value.newValue ?? item.first.value.raw.value}`;
            }
        }

        if (statusTypes.length > 0) message += `\`\`\``;
        if (errors.length > 0) message += `\n# Errors Changed\n \`\`\`diff`;

        for (const item of errors) {
            if (item.first.action === "Changed") {
                message += `\n- ${item.first.value.oldName} - ${item.first.value.oldValue}`;
                message += `\n+ ${item.first.value.newName} - ${item.first.value.newValue}`;
            } else {
                message += `\n${item.first.action === "Added" ? "+" : item.first.action === "Removed" ? "-" : "+"} ${item.first.value.newName ?? item.first.value.raw.name} - ${item.first.value.newValue ?? item.first.value.raw.value}`;
            }
        }

        if (errors.length > 0) message += `\`\`\``;
        if (userFlags.length > 0) message += `\n# User Flags Changed\n \`\`\`diff`;

        for (const item of userFlags) {
            if (item.first.action === "Changed") {
                message += `\n- ${item.first.value.oldName} - ${item.first.value.oldValue}`;
                message += `\n+ ${item.first.value.newName} - ${item.first.value.newValue}`;
            } else {
                message += `\n${item.first.action === "Added" ? "+" : item.first.action === "Removed" ? "-" : "+"} ${item.first.value.newName ?? item.first.value.raw.name} - ${item.first.value.newValue ?? item.first.value.raw.value}`;
            }
        }

        if (userFlags.length > 0) message += `\`\`\``;
        if (unknown.length > 0) message += `\n# Unknown Type Changed\n \`\`\`diff`;

        for (const item of unknown) {
            if (item.first.action === "Changed") {
                message += `\n- ${item.first.value.oldName} - ${item.first.value.oldValue}`;
                message += `\n+ ${item.first.value.newName} - ${item.first.value.newValue}`;
            } else {
                message += `\n${item.first.action === "Added" ? "+" : item.first.action === "Removed" ? "-" : "+"} ${item.first.value.newName ?? item.first.value.raw.name} - ${item.first.value.newValue ?? item.first.value.raw.value}`;
            }
        }

        if (unknown.length > 0) message += `\`\`\``;

        WebhookUtils.send('Changes', message, 0x00FF00, {}, "This is in beta, please expect errors :3");

        console.log(message);
    }

    // const data = read('./saves/old.js');
    // const data2 = read('./saves/current.js');
};

start();

// every minute
setInterval(start, 60000);