'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search, Star, Zap, Clock, ArrowUpRight, CheckCircle2, XCircle,
  Wallet, Send, Activity, Globe, Code2, Server, Users, DollarSign,
  BarChart3, ArrowRight, ChevronRight, Copy, Check, Loader2,
  TrendingUp, AlertCircle, Rocket, Shield, RefreshCw, X,
  LayoutGrid, PanelLeft, CreditCard, History, Plus, ExternalLink,
  FileCode2, Hash, CircleDollarSign, Key, KeyRound, Wifi, WifiOff,
  Link2, Eye, Droplets, Blocks, CircleDot
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
  DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { liteClient as algoliasearch } from 'algoliasearch/lite';
import { SERVICES_INDEX, recordToService, type ServiceRecord } from '@/lib/algolia';

// ── Types ──────────────────────────────────────────────────────────

interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  endpoint: string;
  pricePerCall: number;
  provider: string;
  providerAddr: string;
  status: string;
  totalCalls: number;
  totalRevenue: number;
  rating: number;
  reviewCount: number;
  latency: number;
  uptime: number;
  tags: string;
  apiKey: string;
}

interface Agent {
  id: string;
  name: string;
  role: string;
  balance: number;
  publicKey: string;
  privateKey?: string;
  onChainBalance?: string;
  status: string;
  isOnChain?: boolean;
}

interface ChainInfo {
  chainName: string;
  chainId: number;
  blockHeight: number;
  eraId: number;
  blockHash: string;
  timestamp: string;
  protocolVersion: string;
  stateRootHash: string;
}

interface Payment {
  id: string;
  agentId: string;
  serviceId: string;
  amount: number;
  status: string;
  txHash: string;
  requestId: string;
  responseData: string;
  latencyMs: number;
  createdAt: string;
  agent?: { id: string; name: string; role: string };
  service?: { id: string; name: string; category: string };
  onChain?: boolean;
  deployHash?: string;
}

interface Stats {
  totalPayments: number;
  totalVolume: number;
  activeAgents: number;
  activeServices: number;
  avgLatency: number;
}

interface X402Flow {
  step1: { status: number; message: string; x402Version: string; service: string; price: number; currency: string; payTo: string };
  step2: { status: string; message: string; txHash: string; requestId: string; amount: number; confirmed: boolean };
  step3: { status: number; message: string; requestId: string; latencyMs: number; data: unknown };
}

interface TreasuryDecisionItem {
  id: string;
  agentId: string | null;
  decision: string;
  reasoning: string;
  serviceId: string | null;
  serviceName: string | null;
  amountCSPR: number | null;
  paymentId: string | null;
  deployHash: string | null;
  status: string;
  llmModel: string;
  cycleId: string;
  createdAt: string;
  agent?: { id: string; name: string; role: string } | null;
  service?: { id: string; name: string; category: string; pricePerCall: number } | null;
}

// ── Constants ────────────────────────────────────────────────────────

const CATEGORIES = ['All', 'AI Inference', 'DeFi Oracle', 'Data API', 'RWA Valuation', 'Identity'];

const CATEGORY_COLORS: Record<string, string> = {
  'AI Inference': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'DeFi Oracle': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'Data API': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  'RWA Valuation': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'Identity': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  pending: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  failed: 'bg-red-500/20 text-red-300 border-red-500/30',
};

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(str: string, len: number): string {
  if (!str) return '';
  return str.length > len ? `${str.slice(0, len)}...` : str;
}

function formatCSPR(amount: number): string {
  return amount.toFixed(4);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function StarRating({ rating, count }: { rating: number; count?: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-3.5 w-3.5 ${
            star <= Math.round(rating) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'
          }`}
        />
      ))}
      {count !== undefined && (
        <span className="text-xs text-muted-foreground ml-1">({count})</span>
      )}
    </div>
  );
}

function Copiable({ text, maxLen = 12 }: { text: string; maxLen?: number }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <span
      className="font-mono text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors inline-flex items-center gap-1"
      onClick={handleCopy}
      title={text}
    >
      {truncate(text, maxLen)}
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────

export default function AgentPayPage() {
  // ── State ──────────────────────────────────────────────────────────
  const [services, setServices] = useState<Service[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<Stats>({ totalPayments: 0, totalVolume: 0, activeAgents: 0, activeServices: 0, avgLatency: 0 });
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);

  // On-chain mode
  const [testnetMode, setTestnetMode] = useState(false);
  const [chainInfo, setChainInfo] = useState<ChainInfo | null>(null);
  const [chainInfoLoading, setChainInfoLoading] = useState(false);
  const [generatingKeys, setGeneratingKeys] = useState(false);
  const [fauceting, setFauceting] = useState(false);
  const [refreshingBalance, setRefreshingBalance] = useState(false);

  // Marketplace
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  // ── Algolia marketplace search ──────────────────────────────────
  // When NEXT_PUBLIC_ALGOLIA_* are configured, the marketplace grid is
  // driven by Algolia (typo-tolerant, relevance-ranked, category facet).
  // Otherwise the local substring filter below applies, exactly as before.
  const algoliaClient = useMemo(() => {
    const appId = process.env.NEXT_PUBLIC_ALGOLIA_APP_ID;
    const searchKey = process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY;
    return appId && searchKey ? algoliasearch(appId, searchKey) : null;
  }, []);
  const [algoliaServices, setAlgoliaServices] = useState<Service[] | null>(null);
  const algoliaSeq = useRef(0);

  useEffect(() => {
    if (!algoliaClient) {
      setAlgoliaServices(null);
      return;
    }
    const seq = ++algoliaSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await algoliaClient.search({
          requests: [
            {
              indexName: SERVICES_INDEX,
              query: search,
              filters: 'status:active',
              facetFilters: category !== 'All' ? [`category:${category}`] : undefined,
              hitsPerPage: 60,
            },
          ],
        });
        if (seq !== algoliaSeq.current) return; // a newer query superseded this one
        const hits = (res.results[0] as unknown as { hits: ServiceRecord[] }).hits;
        setAlgoliaServices(hits.map(recordToService));
      } catch {
        if (seq === algoliaSeq.current) setAlgoliaServices(null); // fall back to local filter
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [algoliaClient, search, category]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [callResult, setCallResult] = useState<{ flow: X402Flow; payment: Payment } | null>(null);
  const [onChainMode, setOnChainMode] = useState(false);
  const [calling, setCalling] = useState(false);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);

  // Agent Dashboard
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [fundAmount, setFundAmount] = useState('');
  const [funding, setFunding] = useState(false);
  const [fundDialogOpen, setFundDialogOpen] = useState(false);

  // Developer Portal
  const [devForm, setDevForm] = useState({
    name: '', description: '', category: '', endpoint: '', pricePerCall: '', provider: '',
  });
  const [registering, setRegistering] = useState(false);

  // Payment Explorer
  const [paymentFilter, setPaymentFilter] = useState('All');

  // Treasury Agent
  const [treasuryConfig, setTreasuryConfig] = useState<{
    enabled: boolean; dryRun: boolean; llmModel: string;
    intervalSeconds: number; minBalanceCSPR: number;
    maxSpendPerCycleCSPR: number; allowedCategories: string;
  } | null>(null);
  const [treasuryStatus, setTreasuryStatus] = useState<{
    enabled: boolean; dryRun: boolean; llmModel: string;
    decisionsLast24h: number; executedLast24h: number;
    dryRunLast24h: number; spentLast24hCSPR: number;
    lastCycle: string | null;
  } | null>(null);
  const [treasuryDecisions, setTreasuryDecisions] = useState<TreasuryDecisionItem[]>([]);
  const [treasuryRunning, setTreasuryRunning] = useState(false);
  const [treasuryLastCycle, setTreasuryLastCycle] = useState<{
    cycleId: string; decisionsMade: number; servicesCalled: number;
    totalSpentCSPR: number; errors: string[];
  } | null>(null);
  const [treasurySaving, setTreasurySaving] = useState(false);

  const seededRef = useRef(false);

  // ── Chain Info Fetching ──────────────────────────────────────────
  const fetchChainInfo = useCallback(async () => {
    if (!testnetMode) { setChainInfo(null); return; }
    setChainInfoLoading(true);
    try {
      const res = await fetch('/api/casper/chain-info?XTransformPort=3000');
      if (res.ok) {
        const data = await res.json();
        setChainInfo(data);
      }
    } catch { /* ignore */ }
    setChainInfoLoading(false);
  }, [testnetMode]);

  useEffect(() => { fetchChainInfo(); }, [fetchChainInfo]);

  // ── Data Fetching ─────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [sRes, aRes, pRes, stRes] = await Promise.all([
        fetch('/api/services?XTransformPort=3000'),
        fetch('/api/agents?XTransformPort=3000'),
        fetch('/api/payments?XTransformPort=3000'),
        fetch('/api/stats?XTransformPort=3000'),
      ]);
      const [sData, aData, pData, stData] = await Promise.all([
        sRes.json(), aRes.json(), pRes.json(), stRes.json(),
      ]);
      setServices(sData.services || []);
      setAgents(aData.agents || []);
      setPayments(pData.payments || []);
      setStats(stData);
      if (aData.agents?.length > 0 && !selectedAgentId) {
        setSelectedAgentId(aData.agents[0].id);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }, [selectedAgentId]);

  // ── Treasury Agent: fetch config, status, and recent decisions ───
  const fetchTreasury = useCallback(async () => {
    try {
      const [cRes, sRes, dRes] = await Promise.all([
        fetch('/api/treasury/config?XTransformPort=3000'),
        fetch('/api/treasury/status?XTransformPort=3000'),
        fetch('/api/treasury/decisions?XTransformPort=3000&limit=20'),
      ]);
      const [cData, sData, dData] = await Promise.all([
        cRes.json(), sRes.json(), dRes.json(),
      ]);
      if (cData.config) setTreasuryConfig(cData.config);
      setTreasuryStatus(sData);
      setTreasuryDecisions(dData.decisions || []);
    } catch (err) {
      console.error('Treasury fetch error:', err);
    }
  }, []);

  // ── Treasury Agent: run a decision cycle ──────────────────────────
  const runTreasuryCycle = useCallback(async () => {
    setTreasuryRunning(true);
    setTreasuryLastCycle(null);
    try {
      const res = await fetch('/api/treasury/run?XTransformPort=3000', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.cycle) {
        setTreasuryLastCycle({
          cycleId: data.cycle.cycleId,
          decisionsMade: data.cycle.decisionsMade,
          servicesCalled: data.cycle.servicesCalled,
          totalSpentCSPR: data.cycle.totalSpentCSPR,
          errors: data.cycle.errors || [],
        });
      } else if (data.error) {
        setTreasuryLastCycle({
          cycleId: 'error',
          decisionsMade: 0,
          servicesCalled: 0,
          totalSpentCSPR: 0,
          errors: [data.error + (data.detail ? `: ${data.detail}` : '')],
        });
      }
      await fetchTreasury();
      await fetchAll();
    } catch (err) {
      setTreasuryLastCycle({
        cycleId: 'error',
        decisionsMade: 0,
        servicesCalled: 0,
        totalSpentCSPR: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    } finally {
      setTreasuryRunning(false);
    }
  }, [fetchTreasury, fetchAll]);

  // ── Treasury Agent: update config ────────────────────────────────
  const updateTreasuryConfig = useCallback(async (patch: Record<string, unknown>) => {
    setTreasurySaving(true);
    try {
      const res = await fetch('/api/treasury/config?XTransformPort=3000', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.config) setTreasuryConfig(data.config);
    } finally {
      setTreasurySaving(false);
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      if (!seededRef.current) {
        try {
          await fetch('/api/demo/seed?XTransformPort=3000', { method: 'POST' });
          seededRef.current = true;
          setSeeded(true);
        } catch {
          // Already seeded or error
        }
      }
      await fetchAll();
      await fetchTreasury();
      setLoading(false);
    }
    init();
  }, [fetchAll, fetchTreasury]);

  // ── Derived State ────────────────────────────────────────────────
  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  );

  const filteredServices = useMemo(() => {
    if (algoliaServices) return algoliaServices;
    let result = services;
    if (category !== 'All') {
      result = result.filter((s) => s.category === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.provider.toLowerCase().includes(q),
      );
    }
    return result;
  }, [services, category, search, algoliaServices]);

  const agentPayments = useMemo(
    () => payments.filter((p) => p.agentId === selectedAgentId),
    [payments, selectedAgentId],
  );

  const filteredPayments = useMemo(() => {
    if (paymentFilter === 'All') return payments;
    return payments.filter((p) => p.status === paymentFilter);
  }, [payments, paymentFilter]);

  const myServices = useMemo(
    () => services.filter((s) => s.provider === devForm.provider && devForm.provider !== ''),
    [services, devForm.provider],
  );

  // Spending chart data for Agent Dashboard
  const spendingData = useMemo(() => {
    if (agentPayments.length === 0) return [];
    const max = Math.max(...agentPayments.map((p) => p.amount));
    return agentPayments.slice(0, 10).map((p) => ({
      amount: p.amount,
      height: max > 0 ? (p.amount / max) * 100 : 0,
      service: p.service?.name || 'Unknown',
    }));
  }, [agentPayments]);

  // Volume chart data for Payment Explorer
  const volumeData = useMemo(() => {
    if (payments.length === 0) return [];
    const max = Math.max(...payments.map((p) => p.amount));
    return payments.slice(0, 15).map((p) => ({
      amount: p.amount,
      height: max > 0 ? (p.amount / max) * 100 : 0,
      label: p.service?.name?.slice(0, 8) || '?',
    }));
  }, [payments]);

  // ── Handlers ──────────────────────────────────────────────────────
  // ── Key Generation Handler ──────────────────────────────────────
  const handleGenerateKeys = async (agentId: string) => {
    setGeneratingKeys(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/fund?XTransformPort=3000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generateKeys: true }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchAll();
        return data;
      }
    } catch { /* ignore */ }
    finally { setGeneratingKeys(false); }
    return null;
  };

  // ── Faucet Handler ──────────────────────────────────────────────
  const handleFaucetDrip = async (agentId: string) => {
    setFauceting(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/fund?XTransformPort=3000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ faucetDrip: true }),
      });
      if (res.ok) {
        const data = await res.json();
        await fetchAll();
        return data;
      }
    } catch { /* ignore */ }
    finally { setFauceting(false); }
    return null;
  };

  // ── Refresh On-Chain Balance ────────────────────────────────────
  const handleRefreshBalance = async (agentId: string) => {
    setRefreshingBalance(true);
    try {
      const res = await fetch(`/api/agents/${agentId}/fund?XTransformPort=3000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchAll();
      }
    } catch { /* ignore */ }
    finally { setRefreshingBalance(false); }
  };

  const handleCallService = async (serviceId: string) => {
    if (!selectedAgentId) return;
    setCalling(true);
    setCallResult(null);
    try {
      const res = await fetch(`/api/services/${serviceId}/call?XTransformPort=3000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selectedAgentId, onChain: testnetMode }),
      });
      const data = await res.json();
      if (res.ok) {
        setCallResult({ flow: data.x402Flow, payment: data.payment });
        setOnChainMode(!!data.onChain);
        await fetchAll();
      } else {
        setCallResult({ flow: null as unknown as X402Flow, payment: data });
      }
    } catch {
      setCallResult(null);
    } finally {
      setCalling(false);
    }
  };

  const handleFund = async () => {
    if (!selectedAgentId || !fundAmount || parseFloat(fundAmount) <= 0) return;
    setFunding(true);
    try {
      const res = await fetch(`/api/agents/${selectedAgentId}/fund?XTransformPort=3000`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: parseFloat(fundAmount) }),
      });
      if (res.ok) {
        await fetchAll();
        setFundAmount('');
        setFundDialogOpen(false);
      }
    } catch {
      // error
    } finally {
      setFunding(false);
    }
  };

  const handleRegister = async () => {
    if (!devForm.name || !devForm.description || !devForm.category || !devForm.endpoint || !devForm.pricePerCall || !devForm.provider) return;
    setRegistering(true);
    try {
      const res = await fetch('/api/services?XTransformPort=3000', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...devForm,
          pricePerCall: parseFloat(devForm.pricePerCall),
          providerAddr: `0x${Math.random().toString(16).slice(2, 42).padEnd(40, '0')}`,
        }),
      });
      if (res.ok) {
        await fetchAll();
        setDevForm({ name: '', description: '', category: '', endpoint: '', pricePerCall: '', provider: '' });
      }
    } catch {
      // error
    } finally {
      setRegistering(false);
    }
  };

  // ── Loading Screen ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground text-sm">Initializing AgentPay...</p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/20 flex items-center justify-center">
                <Rocket className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold tracking-tight flex items-center gap-2">
                  AgentPay
                  <span className="hidden sm:inline text-xs font-normal text-muted-foreground">
                    x402 Micropayment Marketplace
                  </span>
                </h1>
                <p className="text-xs text-muted-foreground sm:hidden">x402 Micropayment Marketplace</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {seeded && (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/5 text-xs">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Demo Active
                </Badge>
              )}
            </div>
          </div>
          {/* On-Chain Mode Toggle Bar */}
          <div className="mt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {testnetMode ? (
                  <Wifi className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs font-medium">{testnetMode ? 'Casper Testnet' : 'Demo Mode'}</span>
                <Switch
                  checked={testnetMode}
                  onCheckedChange={setTestnetMode}
                  className="data-[state=checked]:bg-emerald-500"
                />
              </div>
              {testnetMode && (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/5 text-xs animate-in fade-in duration-300">
                  <Shield className="h-3 w-3 mr-1" />
                  On-Chain Payments Active
                </Badge>
              )}
            </div>
            {testnetMode && chainInfo && (
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground animate-in fade-in duration-300">
                <span className="flex items-center gap-1"><Blocks className="h-3 w-3" /> Block #{chainInfo.blockHeight.toLocaleString()}</span>
                <span className="flex items-center gap-1"><CircleDot className="h-3 w-3" /> Era {chainInfo.eraId}</span>
                <button
                  onClick={fetchChainInfo}
                  className="hover:text-foreground transition-colors"
                  title="Refresh chain info"
                >
                  <RefreshCw className={`h-3 w-3 ${chainInfoLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content ───────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <Tabs defaultValue="marketplace" className="w-full">
          <TabsList className="w-full grid grid-cols-5 h-auto p-1 bg-card border border-border rounded-lg">
            <TabsTrigger value="marketplace" className="text-xs sm:text-sm py-2 sm:py-2.5 flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md">
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Marketplace</span>
              <span className="sm:hidden">Market</span>
            </TabsTrigger>
            <TabsTrigger value="dashboard" className="text-xs sm:text-sm py-2 sm:py-2.5 flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md">
              <PanelLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Dashboard</span>
              <span className="sm:hidden">Agent</span>
            </TabsTrigger>
            <TabsTrigger value="treasury" className="text-xs sm:text-sm py-2 sm:py-2.5 flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md">
              <CircleDollarSign className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Treasury Agent</span>
              <span className="sm:hidden">Agent</span>
            </TabsTrigger>
            <TabsTrigger value="developer" className="text-xs sm:text-sm py-2 sm:py-2.5 flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md">
              <Code2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Developer</span>
              <span className="sm:hidden">Dev</span>
            </TabsTrigger>
            <TabsTrigger value="explorer" className="text-xs sm:text-sm py-2 sm:py-2.5 flex items-center gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground rounded-md">
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Explorer</span>
              <span className="sm:hidden">Explore</span>
            </TabsTrigger>
          </TabsList>

          {/* ═══════════════════════════════════════════════════════════
              TAB 1: MARKETPLACE
          ═══════════════════════════════════════════════════════════ */}
          <TabsContent value="marketplace" className="mt-6 space-y-6">
            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search services, providers..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 bg-card border-border"
                />
              </div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full sm:w-48 bg-card border-border">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Service Grid */}
            {filteredServices.length === 0 ? (
              <Card className="bg-card border-border">
                <CardContent className="py-12 text-center">
                  <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">No services found</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Try adjusting your search or category filter</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredServices.map((service) => (
                  <Card
                    key={service.id}
                    className="bg-card border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 cursor-pointer group py-0"
                    onClick={() => {
                      setSelectedService(service);
                      setCallResult(null);
                      setServiceDialogOpen(true);
                    }}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm group-hover:text-primary transition-colors truncate">{service.name}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">{service.provider}</p>
                        </div>
                        <Badge className={`text-[10px] shrink-0 ml-2 border ${CATEGORY_COLORS[service.category] || 'bg-muted text-muted-foreground'}`}>
                          {service.category}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">{service.description}</p>

                      <div className="flex items-center gap-3 mb-3">
                        <StarRating rating={service.rating} count={service.reviewCount} />
                      </div>

                      <Separator className="mb-3" />

                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-xs text-muted-foreground">Price</p>
                          <p className="text-sm font-bold text-accent">{formatCSPR(service.pricePerCall)}</p>
                          <p className="text-[10px] text-muted-foreground">CSPR/call</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Latency</p>
                          <p className="text-sm font-bold text-foreground">{service.latency}</p>
                          <p className="text-[10px] text-muted-foreground">ms</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Uptime</p>
                          <p className="text-sm font-bold text-emerald-400">{service.uptime.toFixed(1)}</p>
                          <p className="text-[10px] text-muted-foreground">%</p>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">
                          <Activity className="h-3 w-3 inline mr-1" />
                          {service.totalCalls.toLocaleString()} calls
                        </span>
                        <span className="text-xs text-primary font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          Details <ArrowUpRight className="h-3 w-3" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Service Detail Dialog */}
            <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
              <DialogContent className="max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
                {selectedService && (
                  <>
                    <DialogHeader>
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
                          <Server className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <DialogTitle className="text-lg">{selectedService.name}</DialogTitle>
                          <p className="text-sm text-muted-foreground">{selectedService.provider}</p>
                        </div>
                      </div>
                    </DialogHeader>

                    {/* Service details */}
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground leading-relaxed">{selectedService.description}</p>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-background rounded-lg p-3 text-center border border-border">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Price</p>
                          <p className="text-lg font-bold text-accent">{formatCSPR(selectedService.pricePerCall)}</p>
                          <p className="text-[10px] text-muted-foreground">CSPR/call</p>
                        </div>
                        <div className="bg-background rounded-lg p-3 text-center border border-border">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Latency</p>
                          <p className="text-lg font-bold">{selectedService.latency}ms</p>
                        </div>
                        <div className="bg-background rounded-lg p-3 text-center border border-border">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Uptime</p>
                          <p className="text-lg font-bold text-emerald-400">{selectedService.uptime.toFixed(1)}%</p>
                        </div>
                        <div className="bg-background rounded-lg p-3 text-center border border-border">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Rating</p>
                          <div className="flex justify-center mt-1">
                            <StarRating rating={selectedService.rating} count={selectedService.reviewCount} />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">Endpoint:</span>
                        <Copiable text={selectedService.endpoint} maxLen={40} />
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">Provider Addr:</span>
                        <Copiable text={selectedService.providerAddr} maxLen={16} />
                      </div>

                      <Separator />

                      {/* x402 Flow Visualization */}
                      <div>
                        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                          <Shield className="h-4 w-4 text-primary" />
                          x402 Payment Protocol Flow
                        </h4>
                        <div className="flex flex-col sm:flex-row gap-3 items-stretch">
                          <StepCard
                            step={1}
                            label="402 Payment Required"
                            status="idle"
                            icon={<XCircle className="h-4 w-4" />}
                          />
                          <ArrowRight className="hidden sm:block h-4 w-4 text-muted-foreground self-center" />
                          <ArrowRight className="sm:hidden h-4 w-4 text-muted-foreground self-center rotate-90" />
                          <StepCard
                            step={2}
                            label="Payment Proof"
                            status="idle"
                            icon={<Send className="h-4 w-4" />}
                          />
                          <ArrowRight className="hidden sm:block h-4 w-4 text-muted-foreground self-center" />
                          <ArrowRight className="sm:hidden h-4 w-4 text-muted-foreground self-center rotate-90" />
                          <StepCard
                            step={3}
                            label="200 OK Response"
                            status="idle"
                            icon={<CheckCircle2 className="h-4 w-4" />}
                          />
                        </div>
                      </div>

                      {/* Call Result */}
                      {callResult && (
                        <div className="space-y-3">
                          <Separator />
                          {callResult.flow && callResult.flow.step1 ? (
                            <>
                              <h4 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4" />
                                x402 Flow {onChainMode ? '(On-Chain Verified)' : 'Completed'}
                              </h4>
                              {onChainMode && (
                                <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 bg-emerald-500/5 text-[10px] mb-2">
                                  <Shield className="h-3 w-3 mr-1" />
                                  Casper Testnet Transfer
                                </Badge>
                              )}
                              <div className="bg-background rounded-lg border border-emerald-500/20 p-4 space-y-3">
                                <FlowStepDetail
                                  step="1"
                                  status={callResult.flow.step1.status}
                                  color="text-amber-400"
                                  lines={[
                                    `${callResult.flow.step1.message}`,
                                    `Service: ${callResult.flow.step1.service}`,
                                    `Amount: ${callResult.flow.step1.price} ${callResult.flow.step1.currency}`,
                                    callResult.flow.step1.onChain ? 'Mode: On-Chain (Real CSPR)' : 'Mode: Demo (Simulated)',
                                  ]}
                                />
                                <FlowStepDetail
                                  step="2"
                                  status={callResult.flow.step2.status === 'on_chain_payment' ? 'submitted' : 'verified'}
                                  color="text-blue-400"
                                  lines={[
                                    `${callResult.flow.step2.message}`,
                                    callResult.flow.step2.blockExplorer ? (
                                      ``
                                    ) : `Tx: ${truncate(callResult.flow.step2.txHash, 20)}`,
                                    `Request: ${callResult.flow.step2.requestId.slice(0, 24)}`,
                                  ]}
                                />
                                {callResult.flow.step2.blockExplorer && (
                                  <a
                                    href={callResult.flow.step2.blockExplorer}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors ml-6 mt-1"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    View on cspr.live
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                      {truncate(callResult.flow.step2.txHash, 16)}
                                    </span>
                                  </a>
                                )}
                                <FlowStepDetail
                                  step="3"
                                  status={200}
                                  color="text-emerald-400"
                                  lines={[
                                    `${callResult.flow.step3.message}`,
                                    `Latency: ${callResult.flow.step3.latencyMs}ms`,
                                  ]}
                                />
                                <div className="bg-card rounded-md p-3">
                                  <p className="text-[10px] text-muted-foreground mb-1">Response Data</p>
                                  <pre className="text-xs font-mono text-emerald-300 overflow-x-auto whitespace-pre-wrap">
                                    {JSON.stringify(callResult.flow.step3.data, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </>
                          ) : callResult.payment?.error ? (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
                              <p className="text-sm text-red-400 font-medium flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                {callResult.payment.error}
                              </p>
                              {callResult.payment.required && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Required: {callResult.payment.required} CSPR &middot; Available: {callResult.payment.available.toFixed(4)} CSPR
                                </p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <DialogFooter className="flex gap-2 sm:justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>Agent:</span>
                        <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                          <SelectTrigger className="h-7 text-xs w-32 bg-background border-border">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {agents.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name} ({formatCSPR(a.balance)})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        onClick={() => handleCallService(selectedService.id)}
                        disabled={calling || !selectedAgentId}
                        className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      >
                        {calling ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4 mr-2" />
                            Call Service
                          </>
                        )}
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════
              TAB 2: AGENT DASHBOARD
          ═══════════════════════════════════════════════════════════ */}
          <TabsContent value="dashboard" className="mt-6 space-y-6">
            {/* Agent Selector */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4 text-primary" />
                Select Agent:
              </div>
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger className="w-full sm:w-64 bg-card border-border">
                  <SelectValue placeholder="Choose an agent" />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <div className="flex items-center gap-2">
                        <span>{a.name}</span>
                        <span className="text-muted-foreground text-xs">({formatCSPR(a.balance)} CSPR)</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedAgent && (
              <>
                {/* Agent Info Card */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card className="bg-card border-border py-0 sm:col-span-2">
                    <CardContent className="p-5">
                      <div className="flex items-center gap-4 mb-4">
                        <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
                          <Users className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold">{selectedAgent.name}</h3>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary bg-primary/5">
                              {selectedAgent.role}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400 bg-emerald-500/5">
                              {selectedAgent.status}
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium">Public Key:</span>
                        <Copiable text={selectedAgent.publicKey} maxLen={20} />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className={`bg-card border-border py-0 ${selectedAgent.isOnChain ? 'glow-emerald' : ''}`}>
                    <CardContent className="p-5 text-center flex flex-col items-center justify-center h-full">
                      <Wallet className="h-6 w-6 text-primary mb-2" />
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                        {testnetMode && selectedAgent.isOnChain ? 'On-Chain Balance' : 'Balance'}
                      </p>
                      {testnetMode && selectedAgent.isOnChain && selectedAgent.onChainBalance ? (
                        <>
                          <p className="text-2xl font-bold text-emerald-400">{selectedAgent.onChainBalance}</p>
                          <p className="text-xs text-muted-foreground mb-1">CSPR (testnet)</p>
                          <button
                            onClick={() => handleRefreshBalance(selectedAgentId)}
                            className="text-[10px] text-primary hover:text-primary/80 transition-colors flex items-center gap-1 mb-2"
                          >
                            <RefreshCw className={`h-2.5 w-2.5 ${refreshingBalance ? 'animate-spin' : ''}`} />
                            Refresh
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="text-2xl font-bold text-primary">{formatCSPR(selectedAgent.balance)}</p>
                          <p className="text-xs text-muted-foreground mb-3">CSPR</p>
                        </>
                      )}
                      {/* Key Management + Funding */}
                      {testnetMode ? (
                        <div className="w-full space-y-2">
                          {!selectedAgent.isOnChain ? (
                            <Button
                              size="sm"
                              onClick={() => handleGenerateKeys(selectedAgentId)}
                              disabled={generatingKeys}
                              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                            >
                              {generatingKeys ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                              ) : (
                                <KeyRound className="h-3.5 w-3.5 mr-1" />
                              )}
                              Generate Ed25519 Keys
                            </Button>
                          ) : (
                            <>
                              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-md p-2 mb-2">
                                <div className="flex items-center gap-1.5 mb-1">
                                  <Key className="h-3 w-3 text-emerald-400" />
                                  <span className="text-[10px] text-emerald-400 font-medium">On-Chain Enabled</span>
                                </div>
                                <p className="text-[9px] font-mono text-muted-foreground truncate">
                                  {selectedAgent.publicKey ? `0x${selectedAgent.publicKey.slice(0, 16)}...` : 'No key'}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => handleFaucetDrip(selectedAgentId)}
                                disabled={fauceting}
                                variant="outline"
                                className="w-full text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                              >
                                {fauceting ? (
                                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                  <Droplets className="h-3.5 w-3.5 mr-1" />
                                )}
                                Faucet Drip (10 CSPR)
                              </Button>
                            </>
                          )}
                        </div>
                      ) : (
                        <Dialog open={fundDialogOpen} onOpenChange={setFundDialogOpen}>
                          <DialogTrigger asChild>
                            <Button size="sm" className="w-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs">
                              <CircleDollarSign className="h-3.5 w-3.5 mr-1" />
                              Fund Wallet
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="bg-card border-border max-w-sm">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <CircleDollarSign className="h-5 w-5 text-primary" />
                                Fund Agent Wallet
                              </DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div className="bg-background rounded-lg p-3 border border-border">
                                <p className="text-xs text-muted-foreground">Funding</p>
                                <p className="text-sm font-semibold">{selectedAgent.name}</p>
                                <p className="text-xs text-muted-foreground">Current: {formatCSPR(selectedAgent.balance)} CSPR</p>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Amount (CSPR)</label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="Enter amount..."
                                  value={fundAmount}
                                  onChange={(e) => setFundAmount(e.target.value)}
                                  className="bg-background border-border"
                                />
                              </div>
                              <div className="flex gap-2">
                                {[10, 25, 50, 100].map((amt) => (
                                  <Button
                                    key={amt}
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 text-xs border-border hover:border-primary/40"
                                    onClick={() => setFundAmount(amt.toString())}
                                  >
                                    {amt}
                                  </Button>
                                ))}
                              </div>
                            </div>
                            <DialogFooter>
                              <Button
                                onClick={handleFund}
                                disabled={funding || !fundAmount || parseFloat(fundAmount) <= 0}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                              >
                                {funding ? (
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                  <Wallet className="h-4 w-4 mr-2" />
                                )}
                                Fund {fundAmount ? `${fundAmount} CSPR` : ''}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Spending Chart */}
                {spendingData.length > 0 && (
                  <Card className="bg-card border-border py-0">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-primary" />
                        Recent Spending
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-5 pt-2">
                      <div className="flex items-end gap-1.5 h-32">
                        {spendingData.map((item, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <span className="text-[9px] text-muted-foreground">{formatCSPR(item.amount)}</span>
                            <div
                              className="w-full bg-gradient-to-t from-primary to-emerald-400 rounded-t-sm min-h-[4px] transition-all duration-500"
                              style={{ height: `${Math.max(item.height, 4)}%` }}
                            />
                            <span className="text-[8px] text-muted-foreground truncate w-full text-center">{truncate(item.service, 8)}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Payment History */}
                <Card className="bg-card border-border py-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <History className="h-4 w-4 text-primary" />
                      Payment History
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-5 pt-2">
                    {agentPayments.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        No payment history yet
                      </div>
                    ) : (
                      <ScrollArea className="max-h-96">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-border hover:bg-transparent">
                              <TableHead className="text-xs text-muted-foreground">Service</TableHead>
                              <TableHead className="text-xs text-muted-foreground">Amount</TableHead>
                              <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                              <TableHead className="text-xs text-muted-foreground hidden sm:table-cell">Tx Hash</TableHead>
                              <TableHead className="text-xs text-muted-foreground">Date</TableHead>
                              <TableHead className="text-xs text-muted-foreground">Latency</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {agentPayments.map((p) => (
                              <TableRow key={p.id} className="border-border">
                                <TableCell className="text-xs font-medium">{p.service?.name || '-'}</TableCell>
                                <TableCell className="text-xs text-accent font-medium">{formatCSPR(p.amount)} CSPR</TableCell>
                                <TableCell>
                                  <Badge className={`text-[10px] border ${STATUS_COLORS[p.status] || ''}`}>
                                    {p.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="hidden sm:table-cell">
                                  <Copiable text={p.txHash} maxLen={10} />
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{p.latencyMs}ms</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════
              TAB 3: TREASURY AGENT (LLM-driven autonomous decision engine)
          ═══════════════════════════════════════════════════════════ */}
          <TabsContent value="treasury" className="mt-6 space-y-6">

            {/* ── Hero / explainer card ── */}
            <Card className="bg-gradient-to-br from-card via-card to-primary/5 border-primary/30">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl">
                      <CircleDollarSign className="h-5 w-5 text-primary" />
                      Treasury Agent
                    </CardTitle>
                    <CardDescription className="mt-1 max-w-2xl">
                      LLM-driven autonomous decision engine. Watches every agent's on-chain
                      balance, asks <code className="text-xs px-1 py-0.5 rounded bg-muted">{treasuryConfig?.llmModel || 'glm-4.6'}</code> which
                      service each agent should call, and executes the x402 payment flow on
                      their behalf — real Ed25519-signed Casper deploys, no human in the loop.
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      treasuryConfig?.enabled
                        ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/5'
                        : 'border-muted-foreground/30 text-muted-foreground'
                    }
                  >
                    {treasuryConfig?.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-md border border-border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">24h Decisions</div>
                    <div className="text-xl font-semibold mt-1">{treasuryStatus?.decisionsLast24h ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">24h Executed</div>
                    <div className="text-xl font-semibold mt-1 text-emerald-400">{treasuryStatus?.executedLast24h ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">24h Dry-Run</div>
                    <div className="text-xl font-semibold mt-1 text-amber-400">{treasuryStatus?.dryRunLast24h ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-border bg-card/50 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">24h Spent (CSPR)</div>
                    <div className="text-xl font-semibold mt-1">{(treasuryStatus?.spentLast24hCSPR ?? 0).toFixed(4)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Button
                    onClick={runTreasuryCycle}
                    disabled={treasuryRunning || !treasuryConfig?.enabled}
                    className="bg-primary hover:bg-primary/90"
                  >
                    {treasuryRunning ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Running cycle…</>
                    ) : (
                      <><Zap className="h-4 w-4 mr-2" /> Run decision cycle now</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => fetchTreasury()}
                    disabled={treasuryRunning}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" /> Refresh
                  </Button>
                  {treasuryConfig && (
                    <Button
                      variant="outline"
                      onClick={() => updateTreasuryConfig({ dryRun: !treasuryConfig.dryRun })}
                      disabled={treasurySaving}
                    >
                      {treasuryConfig.dryRun ? (
                        <><Wifi className="h-4 w-4 mr-2" /> Switch to LIVE mode</>
                      ) : (
                        <><WifiOff className="h-4 w-4 mr-2" /> Switch to DRY-RUN</>
                      )}
                    </Button>
                  )}
                </div>

                {/* Last cycle result banner */}
                {treasuryLastCycle && (
                  <div className={`rounded-md border p-3 text-sm ${
                    treasuryLastCycle.cycleId === 'error'
                      ? 'border-red-500/40 bg-red-500/5 text-red-300'
                      : treasuryLastCycle.errors.length > 0
                        ? 'border-amber-500/40 bg-amber-500/5 text-amber-300'
                        : 'border-emerald-500/40 bg-emerald-500/5 text-emerald-300'
                  }`}>
                    {treasuryLastCycle.cycleId === 'error' ? (
                      <div className="font-mono text-xs">
                        Cycle failed: {treasuryLastCycle.errors[0]}
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div className="font-semibold">
                          Cycle {treasuryLastCycle.cycleId.slice(0, 8)} · {treasuryLastCycle.decisionsMade} decisions · {treasuryLastCycle.servicesCalled} executed · {treasuryLastCycle.totalSpentCSPR.toFixed(4)} CSPR spent
                        </div>
                        {treasuryLastCycle.errors.length > 0 && (
                          <ul className="text-xs list-disc list-inside opacity-80">
                            {treasuryLastCycle.errors.map((e, i) => (
                              <li key={i}>{e}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Config card ── */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Configuration</CardTitle>
                <CardDescription>
                  Tune the Treasury Agent's operating constraints. Changes apply on the next cycle.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {treasuryConfig ? (
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Enabled</label>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={treasuryConfig.enabled}
                          onCheckedChange={(v) => updateTreasuryConfig({ enabled: v })}
                          disabled={treasurySaving}
                        />
                        <span className="text-sm">{treasuryConfig.enabled ? 'On' : 'Off'}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Dry-run mode</label>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={treasuryConfig.dryRun}
                          onCheckedChange={(v) => updateTreasuryConfig({ dryRun: v })}
                          disabled={treasurySaving}
                        />
                        <span className="text-sm">{treasuryConfig.dryRun ? 'Log only (no on-chain calls)' : 'LIVE (real CSPR spends)'}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Min balance reserve (CSPR)</label>
                      <Input
                        type="number"
                        step="0.1"
                        value={treasuryConfig.minBalanceCSPR}
                        onChange={(e) => setTreasuryConfig({ ...treasuryConfig, minBalanceCSPR: parseFloat(e.target.value) || 0 })}
                        onBlur={(e) => updateTreasuryConfig({ minBalanceCSPR: parseFloat(e.target.value) || 0 })}
                        disabled={treasurySaving}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Max spend per cycle (CSPR)</label>
                      <Input
                        type="number"
                        step="0.1"
                        value={treasuryConfig.maxSpendPerCycleCSPR}
                        onChange={(e) => setTreasuryConfig({ ...treasuryConfig, maxSpendPerCycleCSPR: parseFloat(e.target.value) || 0 })}
                        onBlur={(e) => updateTreasuryConfig({ maxSpendPerCycleCSPR: parseFloat(e.target.value) || 0 })}
                        disabled={treasurySaving}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">LLM model</label>
                      <Select
                        value={treasuryConfig.llmModel}
                        onValueChange={(v) => updateTreasuryConfig({ llmModel: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="glm-4.6">glm-4.6</SelectItem>
                          <SelectItem value="glm-4.5">glm-4.5</SelectItem>
                          <SelectItem value="glm-4.5-air">glm-4.5-air</SelectItem>
                          <SelectItem value="glm-4.5v">glm-4.5v (vision)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs uppercase tracking-wider text-muted-foreground">Allowed categories (comma-separated, empty = all)</label>
                      <Input
                        placeholder="e.g. DeFi Oracle,AI Inference"
                        value={treasuryConfig.allowedCategories}
                        onChange={(e) => setTreasuryConfig({ ...treasuryConfig, allowedCategories: e.target.value })}
                        onBlur={(e) => updateTreasuryConfig({ allowedCategories: e.target.value })}
                        disabled={treasurySaving}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">Loading configuration…</div>
                )}
              </CardContent>
            </Card>

            {/* ── Recent decisions card ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Recent Decisions</CardTitle>
                    <CardDescription>
                      Each row is one LLM-produced decision. Click a deploy hash to view it on testnet.cspr.live.
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{treasuryDecisions.length} shown</Badge>
                </div>
              </CardHeader>
              <CardContent>
                {treasuryDecisions.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    No decisions yet. Click <strong>Run decision cycle now</strong> to invoke the LLM.
                  </div>
                ) : (
                  <ScrollArea className="h-[420px] rounded-md border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">When</TableHead>
                          <TableHead className="text-xs">Agent</TableHead>
                          <TableHead className="text-xs">Decision</TableHead>
                          <TableHead className="text-xs">Service</TableHead>
                          <TableHead className="text-xs">CSPR</TableHead>
                          <TableHead className="text-xs">Status</TableHead>
                          <TableHead className="text-xs">Reasoning</TableHead>
                          <TableHead className="text-xs">Deploy</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {treasuryDecisions.map((d) => {
                          const isCall = d.decision === 'call_service';
                          const statusColor = d.status === 'executed'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                            : d.status === 'dry_run'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              : 'bg-muted-foreground/20 text-muted-foreground border-muted-foreground/30';
                          return (
                            <TableRow key={d.id}>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {formatDate(d.createdAt)}
                              </TableCell>
                              <TableCell className="text-xs">
                                <div className="font-medium">{d.agent?.name || '—'}</div>
                                <div className="text-[10px] text-muted-foreground">{d.agent?.role || ''}</div>
                              </TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className={`text-[10px] ${
                                  isCall
                                    ? 'border-primary/30 text-primary'
                                    : 'border-muted-foreground/30 text-muted-foreground'
                                }`}>
                                  {isCall ? 'CALL' : 'NO-ACTION'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">
                                {d.serviceName || '—'}
                              </TableCell>
                              <TableCell className="text-xs font-mono">
                                {d.amountCSPR != null ? d.amountCSPR.toFixed(4) : '—'}
                              </TableCell>
                              <TableCell className="text-xs">
                                <Badge variant="outline" className={`text-[10px] ${statusColor}`}>
                                  {d.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs max-w-[280px]">
                                <div className="line-clamp-2 text-muted-foreground">{d.reasoning}</div>
                              </TableCell>
                              <TableCell className="text-xs">
                                {d.deployHash ? (
                                  <a
                                    href={`https://testnet.cspr.live/deploy/${d.deployHash.replace(/^0x/, '')}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                                  >
                                    {d.deployHash.slice(2, 10)}…
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════
              TAB 4: DEVELOPER PORTAL
          ═══════════════════════════════════════════════════════════ */}
          <TabsContent value="developer" className="mt-6 space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Registration Form */}
              <Card className="bg-card border-border py-0">
                <CardHeader>
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Plus className="h-4 w-4 text-primary" />
                    Register New Service
                  </CardTitle>
                  <CardDescription className="text-xs">List your AI service on the AgentPay marketplace</CardDescription>
                </CardHeader>
                <CardContent className="p-5 pt-2 space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Service Name</label>
                    <Input
                      placeholder="e.g., My AI Inference API"
                      value={devForm.name}
                      onChange={(e) => setDevForm({ ...devForm, name: e.target.value })}
                      className="bg-background border-border"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Description</label>
                    <Textarea
                      placeholder="Describe what your service does..."
                      value={devForm.description}
                      onChange={(e) => setDevForm({ ...devForm, description: e.target.value })}
                      className="bg-background border-border min-h-[80px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                      <Select value={devForm.category} onValueChange={(v) => setDevForm({ ...devForm, category: v })}>
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Price (CSPR/call)</label>
                      <Input
                        type="number"
                        step="0.001"
                        min="0"
                        placeholder="0.05"
                        value={devForm.pricePerCall}
                        onChange={(e) => setDevForm({ ...devForm, pricePerCall: e.target.value })}
                        className="bg-background border-border"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Endpoint URL</label>
                    <Input
                      placeholder="https://api.example.com/v1/inference"
                      value={devForm.endpoint}
                      onChange={(e) => setDevForm({ ...devForm, endpoint: e.target.value })}
                      className="bg-background border-border"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Provider Name</label>
                    <Input
                      placeholder="Your name or company"
                      value={devForm.provider}
                      onChange={(e) => setDevForm({ ...devForm, provider: e.target.value })}
                      className="bg-background border-border"
                    />
                  </div>
                  <Button
                    onClick={handleRegister}
                    disabled={registering || !devForm.name || !devForm.description || !devForm.category || !devForm.endpoint || !devForm.pricePerCall || !devForm.provider}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {registering ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    Register Service
                  </Button>
                </CardContent>
              </Card>

              {/* My Services + Code Example */}
              <div className="space-y-6">
                {/* My Services */}
                <Card className="bg-card border-border py-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Server className="h-4 w-4 text-primary" />
                      My Services
                      {devForm.provider && (
                        <Badge variant="outline" className="text-[10px] border-border">{devForm.provider}</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-5 pt-2">
                    {myServices.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        <Server className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        {!devForm.provider
                          ? 'Enter your provider name to see your services'
                          : 'No services registered yet'}
                      </div>
                    ) : (
                      <ScrollArea className="max-h-48">
                        <div className="space-y-2">
                          {myServices.map((s) => (
                            <div key={s.id} className="flex items-center justify-between bg-background rounded-lg p-3 border border-border">
                              <div>
                                <p className="text-sm font-medium">{s.name}</p>
                                <p className="text-xs text-muted-foreground">{s.category} &middot; {formatCSPR(s.pricePerCall)} CSPR/call</p>
                              </div>
                              <Badge className={`text-[10px] border ${s.status === 'active' ? STATUS_COLORS.completed : STATUS_COLORS.pending}`}>
                                {s.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>

                {/* Code Example */}
                <Card className="bg-card border-border py-0">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <FileCode2 className="h-4 w-4 text-accent" />
                      x402 Integration Example
                    </CardTitle>
                    <CardDescription className="text-xs">Implement the x402 payment protocol in your AI agent</CardDescription>
                  </CardHeader>
                  <CardContent className="p-5 pt-2">
                    <div className="bg-background rounded-lg border border-border p-4 overflow-x-auto">
                      <pre className="text-xs font-mono leading-relaxed text-foreground/90">
{`// x402 Payment Flow
const response = await fetch(endpoint);
if (response.status === 402) {
  const address = response.headers.get('X-Payment-Address');
  const amount = response.headers.get('X-Payment-Amount');
  // Sign payment proof with Casper account
  const proof = await signPayment({ address, amount });
  // Retry with payment proof
  const result = await fetch(endpoint, {
    headers: {
      'X-Payment': \`casper:\${address}:\${amount}:\${proof}\`
    }
  });
  return result.json();
}`}
                      </pre>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/70 bg-primary/5">
                        HTTP 402
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-accent/30 text-accent/70 bg-accent/5">
                        CSPR Payments
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-blue-500/30 text-blue-400/70 bg-blue-500/5">
                        Casper Signatures
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400/70 bg-emerald-500/5">
                        REST API
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* ═══════════════════════════════════════════════════════════
              TAB 4: PAYMENT EXPLORER
          ═══════════════════════════════════════════════════════════ */}
          <TabsContent value="explorer" className="mt-6 space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card className="bg-card border-border py-0">
                <CardContent className="p-4 text-center">
                  <CreditCard className="h-5 w-5 text-primary mx-auto mb-1" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Payments</p>
                  <p className="text-xl font-bold">{stats.totalPayments.toLocaleString()}</p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border py-0">
                <CardContent className="p-4 text-center">
                  <DollarSign className="h-5 w-5 text-accent mx-auto mb-1" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Volume</p>
                  <p className="text-xl font-bold text-accent">{formatCSPR(stats.totalVolume)}</p>
                  <p className="text-[10px] text-muted-foreground">CSPR</p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border py-0">
                <CardContent className="p-4 text-center">
                  <Users className="h-5 w-5 text-blue-400 mx-auto mb-1" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Agents</p>
                  <p className="text-xl font-bold text-blue-400">{stats.activeAgents}</p>
                </CardContent>
              </Card>
              <Card className="bg-card border-border py-0">
                <CardContent className="p-4 text-center">
                  <Server className="h-5 w-5 text-emerald-400 mx-auto mb-1" />
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Active Services</p>
                  <p className="text-xl font-bold text-emerald-400">{stats.activeServices}</p>
                </CardContent>
              </Card>
            </div>

            {/* Volume Chart */}
            {volumeData.length > 0 && (
              <Card className="bg-card border-border py-0">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    Payment Volume Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-5 pt-2">
                  <div className="flex items-end gap-1 h-40">
                    {volumeData.map((item, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[8px] text-muted-foreground">{formatCSPR(item.amount)}</span>
                        <div
                          className="w-full bg-gradient-to-t from-accent to-amber-300 rounded-t-sm min-h-[4px] transition-all duration-500"
                          style={{ height: `${Math.max(item.height, 4)}%` }}
                        />
                        <span className="text-[7px] text-muted-foreground truncate w-full text-center">{item.label}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Filter + Table */}
            <Card className="bg-card border-border py-0">
              <CardHeader className="pb-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" />
                    All Payments
                    <Badge variant="outline" className="text-[10px] border-border">{filteredPayments.length}</Badge>
                  </CardTitle>
                  <Select value={paymentFilter} onValueChange={setPaymentFilter}>
                    <SelectTrigger className="h-8 w-32 text-xs bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="All">All</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-5 pt-2">
                {filteredPayments.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    No payments found
                  </div>
                ) : (
                  <ScrollArea className="max-h-[500px]">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-xs text-muted-foreground">Agent</TableHead>
                          <TableHead className="text-xs text-muted-foreground">Service</TableHead>
                          <TableHead className="text-xs text-muted-foreground">Amount</TableHead>
                          <TableHead className="text-xs text-muted-foreground">Status</TableHead>
                          <TableHead className="text-xs text-muted-foreground hidden md:table-cell">Tx Hash</TableHead>
                          <TableHead className="text-xs text-muted-foreground">Date</TableHead>
                          <TableHead className="text-xs text-muted-foreground hidden sm:table-cell">Latency</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPayments.map((p) => (
                          <TableRow key={p.id} className="border-border">
                            <TableCell className="text-xs font-medium">{p.agent?.name || '-'}</TableCell>
                            <TableCell className="text-xs">{p.service?.name || '-'}</TableCell>
                            <TableCell className="text-xs text-accent font-medium">{formatCSPR(p.amount)} CSPR</TableCell>
                            <TableCell>
                              <Badge className={`text-[10px] border ${STATUS_COLORS[p.status] || ''}`}>
                                {p.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <Copiable text={p.txHash} maxLen={10} />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground hidden sm:table-cell">{p.latencyMs}ms</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-background/50 backdrop-blur-sm mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground text-center sm:text-left">
            AgentPay — x402 Micropayment Marketplace for AI Agents on Casper Network
          </p>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/60">
              <Shield className="h-3 w-3 mr-1" />
              x402 Protocol v1.0
            </Badge>
            <Badge variant={testnetMode ? "outline" : "outline"} className={`text-[10px] ${testnetMode ? 'border-emerald-500/30 text-emerald-400/70 bg-emerald-500/5' : 'border-primary/30 text-primary/60'}`}>
              {testnetMode ? (
                <><Wifi className="h-3 w-3 mr-1" /> Testnet Live</>
              ) : (
                <><Shield className="h-3 w-3 mr-1" /> Demo Mode</>
              )}
            </Badge>
            <span className="text-[10px] text-muted-foreground/50">
              Powered by Casper
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Sub-Components ───────────────────────────────────────────────────

function StepCard({ step, label, status, icon }: { step: number; label: string; status: string; icon: React.ReactNode }) {
  return (
    <div className="flex-1 bg-background rounded-lg p-3 border border-border text-center min-w-0">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <span className="text-[10px] font-bold text-muted-foreground bg-card rounded-full h-5 w-5 flex items-center justify-center border border-border">
          {step}
        </span>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
      <div className="text-muted-foreground flex justify-center">{icon}</div>
    </div>
  );
}

function FlowStepDetail({ step, status, color, lines }: { step: string; status: number | string; color: string; lines: string[] }) {
  return (
    <div className="flex gap-3">
      <div className={`text-[10px] font-bold ${color} bg-background rounded-full h-5 w-5 flex items-center justify-center border border-border shrink-0 mt-0.5`}>
        {step}
      </div>
      <div>
        <p className={`text-xs font-medium ${color}`}>Status {status}</p>
        {lines.map((line, i) => (
          <p key={i} className="text-xs text-muted-foreground">{line}</p>
        ))}
      </div>
    </div>
  );
}
