export type Modality = 'image' | 'video' | 'music';

export type User = {
  username: string;
  role: 'admin' | 'user';
};

export type Me = {
  user: User;
  dailyBudget: number;
  spent: number;
  remaining: number;
};

export type ModelParam = {
  label: string;
  type: 'select' | 'boolean' | 'textarea';
  options?: string[];
  default?: string | boolean;
};

export type Model = {
  id: string;
  label: string;
  provider?: string;
  modality: Modality;
  protocol: string;
  supportsEdit: boolean;
  maxRefImages: number;
  default: boolean;
  note?: string;
  params: Record<string, ModelParam>;
  costUSD: number;
};

export type Asset = {
  id: string;
  sessionId?: string;
  username?: string;
  model: string;
  modality: Modality;
  prompt: string;
  params: Record<string, string | boolean>;
  status: 'pending' | 'processing' | 'done' | 'failed';
  mimeType?: string;
  cost?: number;
  inputUrls?: string[];
  assetUrl: string;
  downloadUrl: string;
  error?: string | null;
  createdAt: string;
  updatedAt?: string;
};

export type GenerateResult = {
  ok: true;
  id: string;
  sessionId: string;
  modality: Modality;
  status: Asset['status'];
  cost: number;
  pollUrl?: string;
  assetUrl?: string;
  mimeType?: string;
  spent: number;
  remaining: number;
};

export type Account = {
  username: string;
  role: 'admin' | 'user';
  dailyBudget: number;
  spentToday: number;
  createdAt: string;
};

export type Usage = {
  date: string;
  totalCount: number;
  totalSpentUSD: number;
  byModality: Record<Modality, { count: number; spentUSD: number }>;
};

export type ServerStatus = {
  configured: boolean;
  fetchedAt?: string;
  cached?: boolean;
  payg?: { total_credits?: number; top_up_credits?: number; bonus_credits?: number };
  paygError?: string;
  subscription?: {
    account_status?: string;
    plan?: { tier?: string; amount_usd?: number; interval?: string; expires_at?: string };
    quota_5_hour?: { usage_percentage?: number; remaining_flows?: number; max_value_usd?: number; used_value_usd?: number; resets_at?: string };
    quota_7_day?: { usage_percentage?: number; remaining_flows?: number; max_value_usd?: number; used_value_usd?: number; resets_at?: string };
  };
  subscriptionError?: string;
};

export type KnowledgeKind = 'okf' | 'contract' | 'catalog';

export type KnowledgeDiagnostic = {
  level: 'error' | 'warning';
  path: string;
  message: string;
};

export type KnowledgeGraphNode = {
  id: string;
  type: 'entity' | 'rule' | 'external' | 'paragraph';
  label: string;
  subtitle?: string;
};

export type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  type: string;
};

export type KnowledgeProjection = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  summary: { entities: number; paragraphs: number; rules: number; externals: number; relations: number };
};

export type KnowledgeListEntry = {
  kind: KnowledgeKind;
  id: string;
  title: string;
  updatedAt: string;
  valid: boolean;
  diagnostics: KnowledgeDiagnostic[];
};

export type KnowledgeDocument = KnowledgeListEntry & {
  content: string;
  projection: KnowledgeProjection | null;
};
