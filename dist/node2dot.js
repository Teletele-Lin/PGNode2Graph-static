// Adapted from PGNode2Graph's Python converter, based on yshen's node2dot.c.
(function (root) {
    "use strict";

    const colors = ["#2f63ac", "#157862", "#7b50a3", "#935622", "#246c83", "#a0446b"];
    const emptyValues = new Set(["<>", "()", "false", "0"]);

    function unwrapInput(input) {
        const source = input.trim();
        const wrapped = source.match(/^(?:\$\d+\s*=\s*)?(?:\([^()\r\n]+\)\s*)?(?:0x[\da-f]+\s+)?"([\s\S]*)"\s*$/i);
        return wrapped ? wrapped[1].replace(/\\(["\\])/g, "$1") : source;
    }

    function parseNodeTree(input, { skipEmpty = false } = {}) {
        const source = unwrapInput(input);
        const start = source.search(/\{\s*[A-Z][A-Z0-9_]*(?=[\s}:])/);
        if (start < 0) {
            throw new SyntaxError("找不到 PostgreSQL 节点。请粘贴调试日志或 nodeToString() 的输出。");
        }

        const nodeName = /\{\s*([A-Z][A-Z0-9_]*)(?=[\s}:])/y;
        const fieldName = /:([A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*)(?=[\s{}()]|$)/y;
        const nodes = [];
        const stack = [];
        let position = start;

        while (position < source.length) {
            const frame = stack.at(-1);
            const character = source[position];

            if (character === "{") {
                nodeName.lastIndex = position;
                const matched = nodeName.exec(source);
                if (!matched) {
                    throw new SyntaxError("遇到了无法识别的节点名称。请检查文本是否完整。");
                }
                if (frame && !frame.field) {
                    throw new SyntaxError("子节点缺少对应的字段名。请检查文本格式。");
                }
                const node = { id: `n${nodes.length + 1}`, tag: matched[1], fields: [] };
                nodes.push(node);

                if (frame) {
                    appendFieldText(frame, source, position);
                    frame.field.children.push(node.id);
                }

                position = nodeName.lastIndex;
                stack.push({ node, field: null, valueStart: position });
                continue;
            }

            if (character === "}") {
                appendFieldText(frame, source, position);
                finishFields(frame.node, skipEmpty);
                stack.pop();
                position++;
                const parent = stack.at(-1);
                if (parent) {
                    parent.valueStart = position;
                } else {
                    while (/\s/.test(source[position] ?? "")) position++;
                    if (source[position] !== "{") break;
                }
                continue;
            }

            if (character === ":" && /\s/.test(source[position - 1] ?? "")) {
                fieldName.lastIndex = position;
                const matched = fieldName.exec(source);
                if (matched) {
                    appendFieldText(frame, source, position);
                    frame.field = { name: matched[1], segments: [], children: [] };
                    frame.node.fields.push(frame.field);
                    position = fieldName.lastIndex;
                    frame.valueStart = position;
                    continue;
                }
            }

            if (character === "\\") {
                position += 2;
            } else if (character === '"') {
                position = afterQuotedString(source, position + 1);
            } else {
                position++;
            }
        }

        if (stack.length) {
            throw new SyntaxError("节点树没有闭合。请检查复制的文本是否被截断。");
        }

        const edges = nodes.flatMap(node => node.fields.flatMap((field, index) =>
            field.children.map(child => ({ from: node.id, field: `f${index + 1}`, to: child }))
        ));
        return { nodes, edges, roots: nodes.length - edges.length };
    }

    function afterQuotedString(source, start) {
        for (let index = start; index < source.length; index++) {
            if (source[index] === '"') return index + 1;
            if (source[index] === "\\") index++;
        }
        throw new SyntaxError("文本中的字符串没有闭合。请检查复制的内容。");
    }

    function appendFieldText(frame, source, end) {
        if (!frame.field) return;
        const text = source.slice(frame.valueStart, end).trim().replace(/[\r\n]+\s*/g, " ");
        if (text) frame.field.segments.push(text);
    }

    function finishFields(node, skipEmpty) {
        for (const field of node.fields) {
            // Parentheses around a list of child nodes are already represented by its edges.
            const segments = field.children.length
                ? field.segments.filter(segment => !/^[()\s]+$/.test(segment))
                : field.segments;
            field.value = segments.join(" ");
            delete field.segments;
        }
        if (skipEmpty) {
            node.fields = node.fields.filter(field =>
                field.children.length || (field.value && !emptyValues.has(field.value))
            );
        }
    }

    function escapeLabel(text) {
        return text.replace(/[\\"{}<>|]/g, "\\$&");
    }

    function colorForTag(tag) {
        let index = 0;
        for (const character of tag) {
            index = (index * 31 + character.charCodeAt(0)) % colors.length;
        }
        return colors[index];
    }

    function node2dot(input, options) {
        const tree = parseNodeTree(input, options);
        const lines = [
            "digraph PGNodes {",
            '  graph [rankdir=LR, bgcolor="transparent", pad=0.25, nodesep=0.3, ranksep=0.65];',
            '  node [shape=Mrecord, style=filled, fillcolor="#ffffff", fontname="Courier New", fontsize=14, fontcolor="#1a2d42"];',
            '  edge [color="#8093aa", arrowsize=0.7];',
        ];
        for (const node of tree.nodes) {
            const fields = node.fields.map((field, index) =>
                `<f${index + 1}> ${field.name}${field.value ? `: ${escapeLabel(field.value)}` : ""}`
            );
            const label = `{<f0> ${node.tag}${fields.length ? ` | {${fields.join(" | ")}}` : ""}}`;
            lines.push(`  ${node.id} [color="${colorForTag(node.tag)}", label="${label}"];`);
        }
        for (const edge of tree.edges) {
            lines.push(`  ${edge.from}:${edge.field} -> ${edge.to}:f0;`);
        }
        lines.push("}");
        return { ...tree, dot: lines.join("\n") };
    }

    if (typeof module === "object" && module.exports) {
        module.exports = { node2dot };
    } else {
        root.PGNode2Dot = { node2dot };
    }
})(globalThis);
