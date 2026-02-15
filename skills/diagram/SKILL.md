---
description: Generate a Mermaid diagram of the architecture
allowed-tools: Bash, Read
user-invocable: true
argument-hint: [--focus <name>] [--layer <name>] [--summary]
---

# /gator:diagram

Generate visual architecture diagrams in Mermaid format.

## Instructions

1. Run the diagram command based on user arguments:

**Full architecture diagram:**
```bash
npx @tyroneross/navgator diagram
```

**Component-focused diagram:**
```bash
npx @tyroneross/navgator diagram --focus "$ARGUMENTS"
```

**Layer diagram:**
```bash
npx @tyroneross/navgator diagram --layer "$ARGUMENTS"
```

**Summary diagram:**
```bash
npx @tyroneross/navgator diagram --summary
```

2. Present the Mermaid output to the user.

## Options

| Option | Description |
|--------|-------------|
| `--focus <name>` | Center diagram on a specific component |
| `--layer <name>` | Show only a specific layer (frontend, backend, database, queue, infra, external) |
| `--summary` | Show only top connected components |
| `--direction <dir>` | Diagram direction: TB, BT, LR, RL (default: TB) |
| `--no-styles` | Disable color styling |
| `--no-labels` | Hide connection labels |
| `--output <file>` | Save to file instead of stdout |
| `--max-nodes <n>` | Maximum nodes to show (default: 50) |

## Tips

1. **Run scan first**: Diagrams are generated from stored architecture data. Run `/gator:scan` first if you haven't already.
2. **Use focus for complex projects**: Large codebases may have too many nodes. Use `--focus` to see specific areas.
3. **Export for documentation**: Use `--output architecture.md` to save directly to your docs folder.
4. **Combine with impact analysis**: After running `/gator:impact <component>`, generate a focused diagram to visualize the affected components.
