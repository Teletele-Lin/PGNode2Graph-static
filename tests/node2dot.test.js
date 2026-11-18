"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { node2dot } = require("../dist/node2dot.js");

test("keeps dotted PostgreSQL plan fields and attaches children to their own fields", () => {
    const input = '(char *) 0x123 "{AGG :plan.disabled_nodes 0 :plan.startup_cost 175.0025 ' +
        ':plan.targetlist ({TARGETENTRY}) :plan.lefttree ' +
        '{FUNCTIONSCAN :scan.plan.targetlist ({TARGETENTRY}) :scan.scanrelid 1}}"';

    for (const skipEmpty of [false, true]) {
        const { nodes, edges, roots } = node2dot(input, { skipEmpty });
        assert.equal(roots, 1);
        assert.deepEqual(nodes.map(node => node.tag), ["AGG", "TARGETENTRY", "FUNCTIONSCAN", "TARGETENTRY"]);
        assert.equal(nodes[0].fields.find(field => field.name === "plan.startup_cost").value, "175.0025");
        assert.equal(nodes[0].fields.some(field => field.name === "plan.disabled_nodes"), !skipEmpty);
        const fieldsWithChildren = edges.map(({ from, field, to }) => [
            nodes.find(node => node.id === from).fields[Number(field.slice(1)) - 1].name,
            nodes.find(node => node.id === to).tag,
        ]);
        assert.deepEqual(fieldsWithChildren, [
            ["plan.targetlist", "TARGETENTRY"],
            ["plan.lefttree", "FUNCTIONSCAN"],
            ["scan.plan.targetlist", "TARGETENTRY"],
        ]);
    }
});

test("decodes quoted field values inside GDB typed-pointer output", () => {
    const tree = '{RESULT :plan.note "text :plan.fake {NOT_A_NODE}" :plan.qual <>}';
    const input = `$1 = (const char *) 0xabc ${JSON.stringify(tree)}`;
    const result = node2dot(input);
    assert.equal(result.nodes.length, 1);
    assert.deepEqual(result.nodes[0].fields.map(({ name, value }) => [name, value]), [
        ["plan.note", '"text :plan.fake {NOT_A_NODE}"'],
        ["plan.qual", "<>"],
    ]);
});
