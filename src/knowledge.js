// OKF + DSL 本地知识库。Markdown 是叙述层；一份 YAML DSL 是流程、规则和图的事实来源。
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import {
  KNOWLEDGE_CONTRACTS_DIR, KNOWLEDGE_HISTORY_DIR, KNOWLEDGE_OKF_DIR, ROOT, writeText,
} from './store.js';

const kinds = new Set(['okf', 'contract']);
const idPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const stepKinds = new Set(['create', 'write', 'change', 'call', 'guard', 'forbid', 'retry', 'next', 'note']);

function assertKind(kind) {
  if (!kinds.has(kind)) throw new Error('知识类型不存在');
}

function assertId(id) {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new Error('文档 ID 仅支持小写字母、数字、连字符和下划线');
}

function locationFor(kind, id) {
  assertKind(kind);
  assertId(id);
  return path.join(kind === 'okf' ? KNOWLEDGE_OKF_DIR : KNOWLEDGE_CONTRACTS_DIR, `${id}.${kind === 'okf' ? 'md' : 'yaml'}`);
}

async function copySeeds(sourceDir, destination, extension) {
  let entries = [];
  try { entries = await fs.readdir(sourceDir, { withFileTypes: true }); } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  await fs.mkdir(destination, { recursive: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map(async (entry) => {
      try {
        await fs.copyFile(path.join(sourceDir, entry.name), path.join(destination, entry.name), fs.constants.COPYFILE_EXCL);
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
    }));
}

/** 首启复制种子；之后永不以代码目录覆盖运营人员在 data/ 的修改。 */
export async function ensureKnowledgeBundle() {
  await Promise.all([
    copySeeds(path.join(ROOT, 'docs', 'okf'), KNOWLEDGE_OKF_DIR, '.md'),
    copySeeds(path.join(ROOT, 'contracts'), KNOWLEDGE_CONTRACTS_DIR, '.yaml'),
  ]);
}

function asArray(value) { return Array.isArray(value) ? value : []; }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function idOf(value) { return typeof value === 'object' && value ? text(value.id) : ''; }
function diagnostic(level, pathName, message) { return { level, path: pathName, message }; }

export function parseFrontmatter(content) {
  if (!content.startsWith('---')) return { attributes: {}, body: content, diagnostics: [diagnostic('error', 'frontmatter', 'OKF 文档必须从 YAML frontmatter 开始')] };
  const end = content.indexOf('\n---', 3);
  if (end < 0) return { attributes: {}, body: content, diagnostics: [diagnostic('error', 'frontmatter', 'YAML frontmatter 未关闭')] };
  try {
    const attributes = YAML.parse(content.slice(3, end).trim()) || {};
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) throw new Error('frontmatter 必须是对象');
    const diagnostics = [];
    if (!text(attributes.type)) diagnostics.push(diagnostic('error', 'frontmatter.type', 'OKF 文档缺少 type'));
    if (!text(attributes.title)) diagnostics.push(diagnostic('error', 'frontmatter.title', 'OKF 文档缺少 title'));
    return { attributes, body: content.slice(end + 4).trimStart(), diagnostics };
  } catch (err) {
    return { attributes: {}, body: content, diagnostics: [diagnostic('error', 'frontmatter', `YAML 无法解析：${err.message}`)] };
  }
}

function uniqueItems(items, type, diagnostics, basePath) {
  const seen = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const id = idOf(items[index]);
    const itemPath = `${basePath}[${index}]`;
    if (!idPattern.test(id)) diagnostics.push(diagnostic('error', `${itemPath}.id`, `${type} 必须有合法 id`));
    else if (seen.has(id)) diagnostics.push(diagnostic('error', `${itemPath}.id`, `${type} id 重复：${id}`));
    else seen.add(id);
  }
  return seen;
}

function visitSteps(steps, context, diagnostics, pathName) {
  if (!Array.isArray(steps)) {
    diagnostics.push(diagnostic('error', pathName, 'steps 必须是数组'));
    return;
  }
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const currentPath = `${pathName}[${index}]`;
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      diagnostics.push(diagnostic('error', currentPath, '步骤必须是对象'));
      continue;
    }
    const kind = text(step.kind);
    if (!stepKinds.has(kind)) diagnostics.push(diagnostic('error', `${currentPath}.kind`, `未知步骤类型：${kind || '空'}`));
    if (!text(step.intent) && !text(step.note)) diagnostics.push(diagnostic('warning', currentPath, '建议为步骤补充 intent 或 note，供人和代理理解意图'));
    if ((kind === 'write' || kind === 'change' || kind === 'create') && text(step.entity) && !context.entities.has(text(step.entity))) {
      diagnostics.push(diagnostic('error', `${currentPath}.entity`, `未定义实体：${step.entity}`));
    }
    if ((kind === 'write' || kind === 'change') && text(step.entity) && text(step.to)) {
      const states = context.entityStates.get(text(step.entity)) || new Set();
      if (states.size && !states.has(text(step.to))) diagnostics.push(diagnostic('error', `${currentPath}.to`, `实体 ${step.entity} 未定义状态：${step.to}`));
      if (text(step.from) && states.size && !states.has(text(step.from))) diagnostics.push(diagnostic('error', `${currentPath}.from`, `实体 ${step.entity} 未定义状态：${step.from}`));
    }
    if (kind === 'call') {
      const external = text(step.external);
      if (!external || !context.externals.has(external)) diagnostics.push(diagnostic('error', `${currentPath}.external`, `未定义外部能力：${external || '空'}`));
      else if (text(step.operation) && !context.operations.get(external)?.has(text(step.operation))) diagnostics.push(diagnostic('error', `${currentPath}.operation`, `外部能力 ${external} 未定义操作：${step.operation}`));
    }
    if (kind === 'guard' && !text(step.condition)) diagnostics.push(diagnostic('warning', `${currentPath}.condition`, 'guard 建议声明 condition'));
    if (text(step.next) && !context.paragraphs.has(text(step.next))) diagnostics.push(diagnostic('error', `${currentPath}.next`, `下一段不存在：${step.next}`));
    for (const childKey of ['then', 'else', 'steps']) {
      if (step[childKey] !== undefined) visitSteps(step[childKey], context, diagnostics, `${currentPath}.${childKey}`);
    }
  }
}

function flowTargets(paragraph) {
  const targets = [];
  if (text(paragraph.next)) targets.push({ to: text(paragraph.next), label: 'next', type: 'flow' });
  for (const branch of asArray(paragraph.branches)) {
    if (text(branch?.next)) targets.push({ to: text(branch.next), label: text(branch.id) || 'branch', type: branch.classification || 'branch' });
  }
  const scan = (steps) => asArray(steps).forEach((step) => {
    if (text(step?.next)) targets.push({ to: text(step.next), label: text(step.kind) || 'next', type: 'flow' });
    ['then', 'else', 'steps'].forEach((key) => { if (step?.[key]) scan(step[key]); });
  });
  scan(paragraph.steps);
  return targets;
}

export function validateContract(content) {
  const diagnostics = [];
  let document;
  try { document = YAML.parse(content); } catch (err) {
    return { valid: false, diagnostics: [diagnostic('error', 'document', `YAML 无法解析：${err.message}`)], document: null, projection: emptyProjection() };
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { valid: false, diagnostics: [diagnostic('error', 'document', 'DSL 根节点必须是 YAML 对象')], document: null, projection: emptyProjection() };
  }
  if (document.dsl !== 'gimage/1') diagnostics.push(diagnostic('error', 'dsl', 'dsl 必须为 gimage/1'));
  if (!idPattern.test(text(document.id))) diagnostics.push(diagnostic('error', 'id', '契约必须有合法 id'));
  if (!text(document.title)) diagnostics.push(diagnostic('error', 'title', '契约缺少 title'));

  const entities = asArray(document.entities);
  const rules = asArray(document.rules);
  const externals = asArray(document.externals);
  const paragraphs = asArray(document.paragraphs);
  const relations = asArray(document.relations);
  const entityIds = uniqueItems(entities, '实体', diagnostics, 'entities');
  const ruleIds = uniqueItems(rules, '规则', diagnostics, 'rules');
  const externalIds = uniqueItems(externals, '外部能力', diagnostics, 'externals');
  const paragraphIds = uniqueItems(paragraphs, '段落', diagnostics, 'paragraphs');
  const entityStates = new Map();
  const operations = new Map();
  for (let index = 0; index < entities.length; index += 1) {
    const item = entities[index];
    const states = asArray(item?.states).map(text).filter(Boolean);
    if (states.length !== new Set(states).size) diagnostics.push(diagnostic('error', `entities[${index}].states`, '状态不能重复'));
    entityStates.set(text(item?.id), new Set(states));
  }
  for (let index = 0; index < externals.length; index += 1) {
    const item = externals[index];
    const operationIds = uniqueItems(asArray(item?.operations), '操作', diagnostics, `externals[${index}].operations`);
    operations.set(text(item?.id), operationIds);
  }
  const context = { entities: entityIds, entityStates, externals: externalIds, operations, paragraphs: paragraphIds };
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const itemPath = `paragraphs[${index}]`;
    if (!text(paragraph?.intent) && !text(paragraph?.note)) diagnostics.push(diagnostic('warning', itemPath, '建议补充 intent 或 note，解释该段落的业务目的'));
    if (text(paragraph?.next) && !paragraphIds.has(text(paragraph.next))) diagnostics.push(diagnostic('error', `${itemPath}.next`, `下一段不存在：${paragraph.next}`));
    visitSteps(paragraph?.steps, context, diagnostics, `${itemPath}.steps`);
    const branches = asArray(paragraph?.branches);
    for (let branchIndex = 0; branchIndex < branches.length; branchIndex += 1) {
      const branch = branches[branchIndex];
      const branchPath = `${itemPath}.branches[${branchIndex}]`;
      if (!text(branch?.id)) diagnostics.push(diagnostic('error', `${branchPath}.id`, '分支缺少 id'));
      if (!text(branch?.when)) diagnostics.push(diagnostic('warning', `${branchPath}.when`, '分支建议声明触发条件'));
      if (!text(branch?.classification)) diagnostics.push(diagnostic('warning', `${branchPath}.classification`, '分支建议标注 normal 或 exception'));
      if (text(branch?.next) && !paragraphIds.has(text(branch.next))) diagnostics.push(diagnostic('error', `${branchPath}.next`, `下一段不存在：${branch.next}`));
      visitSteps(branch?.steps, context, diagnostics, `${branchPath}.steps`);
    }
  }
  const knownNodes = new Set([...entityIds, ...ruleIds, ...externalIds, ...paragraphIds]);
  for (let index = 0; index < relations.length; index += 1) {
    const relation = relations[index] || {};
    const relationPath = `relations[${index}]`;
    if (!knownNodes.has(text(relation.from))) diagnostics.push(diagnostic('error', `${relationPath}.from`, `关系起点未定义：${text(relation.from) || '空'}`));
    if (!knownNodes.has(text(relation.to))) diagnostics.push(diagnostic('error', `${relationPath}.to`, `关系终点未定义：${text(relation.to) || '空'}`));
    if (!text(relation.kind)) diagnostics.push(diagnostic('error', `${relationPath}.kind`, '关系缺少 kind'));
  }
  const projection = createProjection(document);
  return { valid: !diagnostics.some((item) => item.level === 'error'), diagnostics, document, projection };
}

function emptyProjection() { return { nodes: [], edges: [], summary: { entities: 0, paragraphs: 0, rules: 0, externals: 0, relations: 0 } }; }

export function createProjection(document) {
  if (!document || typeof document !== 'object') return emptyProjection();
  const nodes = [];
  const edges = [];
  const addNodes = (items, type, label = 'title') => asArray(items).forEach((item) => {
    const id = text(item?.id);
    if (id) nodes.push({ id, type, label: text(item[label]) || id, subtitle: text(item?.intent) || text(item?.kind) || type });
  });
  addNodes(document.entities, 'entity', 'title');
  addNodes(document.rules, 'rule', 'title');
  addNodes(document.externals, 'external', 'title');
  addNodes(document.paragraphs, 'paragraph', 'title');
  const nodeIds = new Set(nodes.map((node) => node.id));
  asArray(document.paragraphs).forEach((paragraph) => flowTargets(paragraph).forEach((target, index) => {
    if (nodeIds.has(paragraph.id) && nodeIds.has(target.to)) edges.push({ id: `flow-${paragraph.id}-${target.to}-${index}`, source: paragraph.id, target: target.to, label: target.label, type: target.type });
  }));
  asArray(document.relations).forEach((relation, index) => {
    if (nodeIds.has(relation?.from) && nodeIds.has(relation?.to)) edges.push({ id: `relation-${relation.from}-${relation.to}-${index}`, source: relation.from, target: relation.to, label: text(relation.kind), type: 'relation' });
  });
  return {
    nodes,
    edges,
    summary: { entities: asArray(document.entities).length, paragraphs: asArray(document.paragraphs).length, rules: asArray(document.rules).length, externals: asArray(document.externals).length, relations: asArray(document.relations).length },
  };
}

export function validateKnowledgeContent(kind, content) {
  if (kind === 'okf') {
    const parsed = parseFrontmatter(content);
    return { valid: !parsed.diagnostics.some((item) => item.level === 'error'), diagnostics: parsed.diagnostics, document: parsed.attributes, projection: null };
  }
  return validateContract(content);
}

function titleFor(kind, content, id) {
  if (kind === 'okf') return text(parseFrontmatter(content).attributes.title) || id;
  const result = validateContract(content);
  return text(result.document?.title) || id;
}

export async function listKnowledge() {
  await ensureKnowledgeBundle();
  const output = [];
  for (const [kind, directory, extension] of [
    ['okf', KNOWLEDGE_OKF_DIR, '.md'],
    ['contract', KNOWLEDGE_CONTRACTS_DIR, '.yaml'],
  ]) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
      const id = entry.name.slice(0, -extension.length);
      if (!idPattern.test(id)) continue;
      const filePath = locationFor(kind, id);
      const [content, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      const validation = validateKnowledgeContent(kind, content);
      output.push({ kind, id, title: titleFor(kind, content, id), updatedAt: stat.mtime.toISOString(), valid: validation.valid, diagnostics: validation.diagnostics });
    }
  }
  return output.sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
}

export async function readKnowledge(kind, id) {
  await ensureKnowledgeBundle();
  const filePath = locationFor(kind, id);
  let content;
  let stat;
  try { [content, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]); } catch (err) {
    if (err.code === 'ENOENT') throw new Error('知识文档不存在');
    throw err;
  }
  const validation = validateKnowledgeContent(kind, content);
  return { kind, id, title: titleFor(kind, content, id), content, updatedAt: stat.mtime.toISOString(), ...validation };
}

export async function writeKnowledge(kind, id, content, expectedUpdatedAt) {
  if (typeof content !== 'string' || content.length < 1 || content.length > 250_000) throw new Error('文档内容长度需在 1 到 250000 字符之间');
  const current = await readKnowledge(kind, id);
  if (expectedUpdatedAt && expectedUpdatedAt !== current.updatedAt) throw new Error('文档已被其他修改更新，请刷新后再保存');
  const validation = validateKnowledgeContent(kind, content);
  if (!validation.valid) {
    const message = validation.diagnostics.find((item) => item.level === 'error')?.message || '文档校验失败';
    const err = new Error(message);
    err.diagnostics = validation.diagnostics;
    throw err;
  }
  const historyPath = path.join(KNOWLEDGE_HISTORY_DIR, kind, id, `${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
  await writeText(historyPath, current.content);
  await writeText(locationFor(kind, id), content);
  return readKnowledge(kind, id);
}
