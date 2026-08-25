import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.join(project, 'app', 'generated', 'timeline-bundle.json');
const [command = 'help', ...args] = process.argv.slice(2);
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

if (command === 'compile') {
  await import('./compile-glm52.mjs');
  process.exit(0);
}

const bundle = JSON.parse(await readFile(artifact, 'utf8'));
const runById = (id) => {
  const run = bundle.runs.find((item) => item.id === id);
  if (!run) throw new Error(`run not found: ${id}`);
  return run;
};

switch (command) {
  case 'list':
    print(bundle.runs.map(({ id, model, label, startedAt, totalSeconds, status }) => ({ id, model, label, startedAt, totalSeconds, status })));
    break;
  case 'show': {
    const run = runById(args[0]);
    const projected = new Set(run.projection.nodeIds);
    print({
      id: run.id,
      model: run.model,
      label: run.label,
      config: run.config,
      totalSeconds: run.totalSeconds,
      status: run.status,
      nodes: run.nodes.filter((node) => projected.has(node.id)),
      relations: run.relations.filter((relation) => run.projection.relationIds.includes(relation.id)),
    });
    break;
  }
  case 'children': {
    const run = runById(args[0]);
    const parentId = args[1];
    const depth = Math.max(1, Number(args[2] ?? 1));
    let frontier = [parentId];
    const result = [];
    for (let level = 1; level <= depth; level += 1) {
      const children = run.nodes.filter((node) => frontier.includes(node.parentId));
      result.push(...children.map((node) => ({ ...node, depth: level })));
      frontier = children.map((node) => node.id);
    }
    print(result);
    break;
  }
  case 'evidence': {
    const run = runById(args[0]);
    const evidenceIds = new Set(run.nodes.flatMap((node) => node.evidence.map((reference) => reference.evidenceId)));
    print(bundle.evidence.filter((item) => evidenceIds.has(item.id)));
    break;
  }
  case 'validate':
    print(bundle.validation);
    if (!bundle.validation.valid) process.exitCode = 1;
    break;
  default:
    process.stdout.write([
      'timeline compile',
      'timeline list',
      'timeline show <run-id>',
      'timeline children <run-id> <node-id> [depth]',
      'timeline evidence <run-id>',
      'timeline validate',
    ].join('\n') + '\n');
}
