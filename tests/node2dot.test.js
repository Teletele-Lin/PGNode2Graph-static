"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { leftAlignDot, node2dot } = require("../dist/node2dot.js");
const Viz = require("../dist/vendor/viz-global.js");

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

test("aligns the left edges of different-width nodes in the same rank", async () => {
    const tree = node2dot("{ROOT :short {VAR :x 1} :long {FUNCEXPR :long_field long_field_value}}");
    const viz = await Viz.instance();
    const layout = JSON.parse(viz.renderString(tree.dot, { format: "json0" }));
    const rendered = viz.renderJSON(leftAlignDot(tree, layout));
    const [, short, long] = rendered.objects;
    const left = node => Number(node.pos.split(",")[0]) - node.width * 36;
    assert.ok(Math.abs(left(short) - left(long)) < 0.1);
    const [title, field] = long._ldraw_.filter(command => command.op === "T");
    assert.equal(title.text, "FUNCEXPR");
    assert.ok(title.pt[0] < field.pt[0]);
    assert.equal(rendered.edges.filter(edge => edge.pos).length, tree.edges.length);
});

test("leaves space for a wider node when a child overlaps its height", async () => {
    const tree = node2dot("{ROOT :children ({WIDE :label a_much_wider_field_value} " +
        "{NARROW :children ({FIRST} {SECOND})})}");
    const viz = await Viz.instance();
    const layout = JSON.parse(viz.renderString(tree.dot, { format: "json0" }));
    const rendered = viz.renderJSON(leftAlignDot(tree, layout));
    const centerX = node => Number(node.pos.split(",")[0]);
    const wide = rendered.objects[1];
    const wideRight = centerX(wide) + wide.width * 36;
    const edges = rendered.edges.filter(edge => edge.tail === 2);
    assert.equal(edges.length, 2);
    for (const edge of edges) {
        const { points } = edge._draw_.find(command => command.op === "b");
        const target = rendered.objects[edge.head];
        const targetLeft = centerX(target) - target.width * 36;
        assert.ok(targetLeft > wideRight);
        assert.ok(points.at(-1)[0] < targetLeft);
    }
});

test("moves a child column closer to its parent and uses a single curve in clear space", async () => {
    const value = "wide_field_".repeat(5);
    const tree = node2dot(`{ROOT :wide {WIDE :label ${value} :leaf {ITEM}} ` +
        ":short {NARROW :children ({FIRST :col 1} {SECOND :col 2})}}");
    const viz = await Viz.instance();
    const layout = JSON.parse(viz.renderString(tree.dot, { format: "json0" }));
    const rendered = viz.renderJSON(leftAlignDot(tree, layout));
    const [, wide, , narrow, first, second] = rendered.objects;
    const x = node => Number(node.pos.split(",")[0]);
    const left = node => x(node) - node.width * 36;
    const right = node => x(node) + node.width * 36;
    assert.ok(left(first) > right(narrow) && left(first) < right(wide));
    assert.ok(Math.abs(left(first) - left(second)) < 0.1);

    const curves = rendered.edges.filter(edge => edge.tail === 3).map(edge =>
        edge._draw_.find(command => command.op === "b").points
    );
    assert.equal(curves.length, 2);
    assert.ok(curves.every(points => points.length === 4));
    assert.ok(curves.some(points => points[0][1] !== points[3][1]));
});

test("branches a shared args port without crossing its own edges", async () => {
    const vars = "{VAR} ".repeat(16);
    const input = `{QUERY :utilityStmt ({EXPLAINSTMT :query ({QUERY
        :rtable ({RANGETBLENTRY} {RANGETBLENTRY} {RANGETBLENTRY :joinaliasvars (${vars})} {RANGETBLENTRY})
        :groupClause ({SORTGROUPCLAUSE} {SORTGROUPCLAUSE})
        :havingQual ({OPEXPR :opno 419 :opresulttype 16 :args ({AGGREF} {CONST}) :location -1})
        :sortClause ({SORTGROUPCLAUSE :nulls_first true})})})}`;
    const tree = node2dot(input, { skipEmpty: true });
    const viz = await Viz.instance();
    const layout = JSON.parse(viz.renderString(tree.dot, { format: "json0" }));
    const rendered = viz.renderJSON(leftAlignDot(tree, layout));
    const operator = tree.nodes.findIndex(node => node.tag === "OPEXPR");
    const curves = rendered.edges.filter(edge => edge.tail === operator).map(edge =>
        edge._draw_.find(command => command.op === "b").points
    );
    assert.equal(curves.length, 2);
    const [first, second] = curves;
    assert.deepEqual(first[0], second[0]);
    assert.deepEqual(first.map(([x]) => x), second.map(([x]) => x));
    assert.notEqual(first.at(-1)[1], second.at(-1)[1]);
});
