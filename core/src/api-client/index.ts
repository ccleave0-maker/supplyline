import type {
  ApiMeta,
  PostPoLoadInput,
  AiTokenHistory,
  ProjectDocumentView,
  SupplierImportPreview,
  SupplierImportResult,
  MfaSetup,
  SecurityEvent,
  SecuritySettings,
  AssistantAskInput,
  AssistantConversationView,
  AssistantMessageView,
  AssistantReply,
  AssistantSettings,
  InsightsView,
  ItemSuggestion,
  NicknameInput,
  NicknameView,
  PoDefaults,
  SuggestionFeedback,
  BuiltReportPreview,
  PmWeeklySettings,
  SavedReportInput,
  SavedReportView,
  EquipmentNeedInput,
  EquipmentNeedView,
  JobMaterialSummary,
  BoardLoad,
  BoardSettings,
  OptimizeInput,
  PostLoadInput,
  SuggestedRun,
  DraftRow,
  ShipViaInput,
  ShipViaView,
  AccessSettings,
  NavLayout,
  NavSettings,
  UserAccessInput,
  PoForBol,
  NavigateInput,
  BillingView,
  ErrorEventView,
  PushSubscriptionInput,
  ActivityItem,
  AppearanceInput,
  DashboardTile,
  HealthRunView,
  HealthSettings,
  NotificationView,
  ReportKey,
  ReportResult,
  SearchHit,
  ActionItemInput,
  ActionItemView,
  MeetingCreateInput,
  MeetingDetail,
  MeetingSummary,
  MeetingTemplateInput,
  MeetingTemplateView,
  MeetingUpdateInput,
  SuggestedAction,
  LineSizeInput,
  LoadItem,
  LoadPlan,
  MakeLoadsInput,
  TrailerInput,
  TrailerView,
  ExportMappingInput,
  ExportMappingView,
  FilingJobView,
  FilingSettings,
  GenericSheetPreview,
  ImportDataset,
  ImportInput,
  ImportResult,
  SyncDeviceView,
  AccountingExportRow,
  AccountingSettings,
  ApActionInput,
  ApDashboard,
  ApDecisionInput,
  ApInvoiceDetail,
  ApInvoiceEditInput,
  ApInvoiceSummary,
  ArInvoiceDetail,
  ArInvoiceInput,
  ArInvoiceSummary,
  ArState,
  BudgetRow,
  CustomerInput,
  CustomerItem,
  JobBudgetInput,
  PayRunRow,
  SubHoldbackInput,
  SubHoldbackView,
  AiLogRow,
  AiSettingsInput,
  AiSettingsView,
  AiStatus,
  AiToggleInput,
  AiToggleRow,
  AiUsageRow,
  InvoiceScanResult,
  QuoteScanResult,
  VoiceFillInput,
  VoiceResult,
  NotifyRulesInput,
  NotifySetup,
  EmailTemplateInput,
  EmailTemplateView,
  OutboxEditInput,
  OutboxItem,
  PoApprovalInput,
  PoDashboard,
  PoDetail,
  PoInput,
  PoSummary,
  PurchasingSettings,
  TableExportInput,
  UniversalScanResult,
  ComplianceInput,
  ComplianceRecordView,
  ComplianceSummary,
  EquipmentDetail,
  EquipmentImportInput,
  EquipmentImportResult,
  EquipmentInput,
  EquipmentItem,
  EquipmentMoveInput,
  QcDocInput,
  QcDocItem,
  RentalInput,
  RentalItem,
  SheetPreview,
  StoredFile,
  SubcontractDocInput,
  SubcontractDocItem,
  RescheduleInput,
  ScheduleFilter,
  ScheduleLoad,
  AvailableLot,
  BolDetail,
  BolInput,
  BolStatus,
  BolSummary,
  DeletedItem,
  DocumentScanResult,
  LocationInput,
  LocationItem,
  ReceiveBolInput,
  ReturnInput,
  SiteReceiptView,
  AssignPoInput,
  CustomColumn,
  CustomColumnInput,
  CustomValue,
  IncomingLine,
  PoLineUpdate,
  ProcurementOrder,
  ProcurementOrderSummary,
  ReceiptDetail,
  ReceiptInput,
  ReceiptSummary,
  ReceivingLookup,
  StockCheckInput,
  StockCheckOrder,
  YardInventoryRow,
  AuthResult,
  BrandingImageKind,
  CompanyCreateInput,
  CompanyDetail,
  CompanySummary,
  CompanyUpdateInput,
  ContactInput,
  ContactItem,
  ContactType,
  CostCodeInput,
  CostCodeItem,
  EmailRecipient,
  EmailRecipientInput,
  GeocodeResult,
  InviteInput,
  InviteListItem,
  LiveEvent,
  Me,
  OrderDetail,
  OrderSummary,
  SaveDraftInput,
  SiteInventoryRow,
  SubmitResult,
  OrgCreateInput,
  OrgListItem,
  OrgUpdateInput,
  ProfileUpdateInput,
  PublicBranding,
  RequestCodeResult,
  SiteDetail,
  SiteEmailRouteInput,
  SiteInput,
  SiteListItem,
  SiteType,
  SiteUpdateInput,
  UserListItem,
  UserUpdateInput,
} from '../models';

import { clearOffline, offlineKey, onOfflineChange, readOffline, saveOffline, setOffline, shouldCache } from './offline';

export { clearOffline } from './offline';

export const API_VERSION = 'v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  clientApp: string;
  clientVersion: string;
  getToken: () => string | null;
  /** The business unit (company) the person is working in — sent so the server can keep units apart */
  getCompanyId?: () => string | null;
  /** Called when the server says the session is no longer valid. */
  onUnauthorized?: () => void;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(q?: Query): string {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function createApi(opts: ApiClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, '');
  const v = `/api/${API_VERSION}`;

  async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
    const headers: Record<string, string> = {
      'X-Client-App': opts.clientApp,
      'X-Client-Version': opts.clientVersion,
    };
    const unit = opts.getCompanyId?.();
    if (unit) headers['X-Company'] = unit;
    const token = opts.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const url = `${path}${qs(query)}`;
    const cacheKey = method === 'GET' && shouldCache(path) ? offlineKey(token, `${unit ?? ''}|${url}`) : null;
    let res: Response;
    try {
      res = await fetch(`${base}${v}${url}`, { method, headers, body: payload });
    } catch {
      // No connection: open the copy saved the last time this was seen (read-only).
      const saved = cacheKey ? readOffline(cacheKey) : null;
      setOffline({ savedAt: saved?.at ?? null });
      if (saved) return JSON.parse(saved.text) as T;
      throw new ApiError(0, 'network', method === 'GET' ? "You're offline and this hasn't been opened on this device before." : "Can't reach Bowron. Check your connection and try again — nothing was saved.");
    }
    setOffline(null);
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (res.ok && cacheKey && text) saveOffline(cacheKey, text);
    if (!res.ok) {
      const err = data?.error ?? {};
      if (res.status === 401 && token) opts.onUnauthorized?.();
      throw new ApiError(res.status, err.code ?? 'error', err.message ?? `Request failed (${res.status})`, err.details?.fields ?? {});
    }
    return data as T;
  }

  function authHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'X-Client-App': opts.clientApp, 'X-Client-Version': opts.clientVersion };
    const unit = opts.getCompanyId?.();
    if (unit) h['X-Company'] = unit;
    const token = opts.getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  /** A file (and optional JSON fields as "data") in one multipart request. */
  const upload = <T>(path: string, file: Blob | null, fileName?: string, data?: unknown) => {
    const form = new FormData();
    if (file) form.append('file', file, fileName ?? 'file');
    if (data !== undefined) form.append('data', JSON.stringify(data));
    return request<T>('POST', path, form);
  };

  /** A file from the server (GET, or POST with a JSON body). */
  async function requestBlob(path: string, body?: unknown): Promise<Blob> {
    let res: Response;
    try {
      res = await fetch(
        `${base}${v}${path}`,
        body === undefined ? { headers: authHeaders() } : { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
    } catch {
      throw new ApiError(0, 'network', "Can't reach Bowron. Check your connection and try again.");
    }
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? `Request failed (${res.status})`);
    }
    return res.blob();
  }

  /**
   * Live updates stream. Reconnects automatically with back-off.
   * Uses fetch (not EventSource) so the login token goes in a header, not the URL.
   */
  function subscribeEvents(onEvent: (e: LiveEvent) => void): () => void {
    let stopped = false;
    let controller: AbortController | null = null;
    let delay = 1000;
    const run = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const res = await fetch(`${base}${v}/events`, { headers: authHeaders(), signal: controller.signal });
          if (res.status === 401) return;
          if (!res.ok || !res.body) throw new Error('stream failed');
          delay = 1000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = '';
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              for (const line of chunk.split('\n')) {
                if (line.startsWith('data: ')) {
                  try {
                    onEvent(JSON.parse(line.slice(6)) as LiveEvent);
                  } catch {
                    /* ignore malformed */
                  }
                }
              }
            }
          }
        } catch {
          /* network blip — retry below */
        }
        if (stopped) return;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    };
    void run();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }

  const get = <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query);
  const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
  const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
  const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
  const del = <T>(path: string) => request<T>('DELETE', path);
  const enc = encodeURIComponent;

  return {
    /** Offline copies (read-only) */
    offline: { onChange: onOfflineChange, clear: clearOffline },
    /** Turns a server file path (signed URL) into an absolute URL. */
    fileUrl: (p: string | null | undefined) => (p ? (/^https?:/.test(p) ? p : `${base}${p}`) : null),
    meta: () => get<ApiMeta>('/meta'),
    branding: (companyId: string | null) => get<PublicBranding>('/public/branding', { companyId }),
    auth: {
      requestCode: (email: string) => post<RequestCodeResult>('/auth/request-code', { email }),
      verifyCode: (email: string, code: string) => post<AuthResult>('/auth/verify-code', { email, code }),
      google: (idToken: string) => post<AuthResult>('/auth/google', { idToken }),
      logout: () => post<{ ok: true }>('/auth/logout'),
    },
    me: {
      get: () => get<Me>('/me'),
      update: (input: ProfileUpdateInput) => patch<Me>('/me', input),
      deleteAccount: () => del<{ ok: true }>('/me'),
    },
    companies: {
      list: () => get<CompanySummary[]>('/companies'),
      get: (id: string) => get<CompanyDetail>(`/companies/${enc(id)}`),
      create: (input: CompanyCreateInput) => post<CompanySummary>('/companies', input),
      update: (id: string, input: CompanyUpdateInput) => patch<CompanySummary>(`/companies/${enc(id)}`, input),
      setImage: (id: string, kind: BrandingImageKind, file: Blob, fileName: string) => {
        const form = new FormData();
        form.append('file', file, fileName);
        return put<CompanySummary>(`/companies/${enc(id)}/branding/${kind}`, form);
      },
      clearImage: (id: string, kind: BrandingImageKind) => del<CompanySummary>(`/companies/${enc(id)}/branding/${kind}`),
      addRecipient: (id: string, input: EmailRecipientInput) => post<EmailRecipient>(`/companies/${enc(id)}/recipients`, input),
      removeRecipient: (id: string, rid: string) => del<{ ok: true }>(`/companies/${enc(id)}/recipients/${enc(rid)}`),
    },
    sites: {
      list: (f: { type?: SiteType; companyId?: string | null; includeInactive?: boolean; q?: string } = {}) =>
        get<SiteListItem[]>('/sites', f),
      get: (id: string) => get<SiteDetail>(`/sites/${enc(id)}`),
      create: (input: SiteInput) => post<{ id: string }>('/sites', input),
      update: (id: string, input: SiteUpdateInput) => patch<{ id: string }>(`/sites/${enc(id)}`, input),
      setMembers: (id: string, userIds: string[]) => put<{ ok: true }>(`/sites/${enc(id)}/members`, { userIds }),
      addEmailRoute: (id: string, input: SiteEmailRouteInput) => post<{ id: string }>(`/sites/${enc(id)}/email-routes`, input),
      removeEmailRoute: (id: string, rid: string) => del<{ ok: true }>(`/sites/${enc(id)}/email-routes/${enc(rid)}`),
      setPstForm: (id: string, file: Blob, fileName: string) => upload<{ fileId: string; url: string }>(`/sites/${enc(id)}/pst-form`, file, fileName),
      documents: (id: string) => get<ProjectDocumentView[]>(`/sites/${enc(id)}/documents`),
      addDocument: (id: string, file: Blob, fileName: string, linkName: string | null) => upload<{ id: string }>(`/sites/${enc(id)}/documents`, file, fileName, { linkName }),
      removePstForm: (id: string) => del<{ fileId: null }>(`/sites/${enc(id)}/pst-form`),
      notifications: (id: string) => get<NotifySetup>(`/sites/${enc(id)}/notifications`),
      saveNotifications: (id: string, input: NotifyRulesInput) => put<NotifySetup>(`/sites/${enc(id)}/notifications`, input),
      rentals: (id: string) => get<RentalItem[]>(`/sites/${enc(id)}/rentals`),
      addRental: (id: string, input: RentalInput) => post<RentalItem>(`/sites/${enc(id)}/rentals`, input),
      qcDocs: (id: string, q?: string) => get<QcDocItem[]>(`/sites/${enc(id)}/qc`, { q }),
      uploadQcDoc: (id: string, input: QcDocInput, file: Blob, fileName: string) => upload<QcDocItem>(`/sites/${enc(id)}/qc`, file, fileName, input),
      subcontracts: (id: string) => get<SubcontractDocItem[]>(`/sites/${enc(id)}/subcontracts`),
      uploadSubcontract: (id: string, input: SubcontractDocInput, file: Blob, fileName: string) =>
        upload<SubcontractDocItem>(`/sites/${enc(id)}/subcontracts`, file, fileName, input),
      setContacts: (id: string, contacts: { contactId: string; roleOnSite?: string | null }[]) =>
        put<{ ok: true }>(`/sites/${enc(id)}/contacts`, { contacts }),
    },
    users: {
      list: (includeInactive = false) => get<UserListItem[]>('/users', { includeInactive }),
      update: (id: string, input: UserUpdateInput) => patch<{ ok: true }>(`/users/${enc(id)}`, input),
    },
    invites: {
      list: () => get<InviteListItem[]>('/invites'),
      create: (input: InviteInput) => post<{ id: string }>('/invites', input),
      revoke: (id: string) => del<{ ok: true }>(`/invites/${enc(id)}`),
    },
    projectDocuments: {
      rename: (id: string, linkName: string) => patch<{ ok: true }>(`/project-documents/${enc(id)}`, { linkName }),
      remove: (id: string) => del<{ ok: true }>(`/project-documents/${enc(id)}`),
    },
    contacts: {
      importSuppliers: <P extends boolean>(file: Blob, fileName: string, companyId: string | null, preview: P) =>
        upload<P extends true ? SupplierImportPreview : SupplierImportResult>(`/contacts/import-suppliers${preview ? '?preview=1' : ''}`, file, fileName, { companyId }),
      list: (f: { q?: string; type?: ContactType; includeInactive?: boolean } = {}) => get<ContactItem[]>('/contacts', f),
      create: (input: ContactInput) => post<ContactItem>('/contacts', input),
      update: (id: string, input: Partial<ContactInput>) => patch<ContactItem>(`/contacts/${enc(id)}`, input),
      remove: (id: string) => del<{ ok: true }>(`/contacts/${enc(id)}`),
      compliance: (id: string) => get<{ summary: ComplianceSummary; records: ComplianceRecordView[] }>(`/contacts/${enc(id)}/compliance`),
      addCompliance: (id: string, input: ComplianceInput, file: Blob | null, fileName?: string) =>
        upload<{ summary: ComplianceSummary; records: ComplianceRecordView[] }>(`/contacts/${enc(id)}/compliance`, file, fileName, input),
    },
    compliance: {
      overview: () => get<ComplianceSummary[]>('/compliance'),
      forVendor: (companyId: string, vendor: string) => get<{ summary: ComplianceSummary | null }>('/compliance', { companyId, vendor }),
      remove: (id: string) => del<{ summary: ComplianceSummary; records: ComplianceRecordView[] }>(`/compliance/${enc(id)}`),
    },
    rentals: {
      update: (id: string, input: Partial<RentalInput>) => patch<RentalItem>(`/rentals/${enc(id)}`, input),
      remove: (id: string) => del<{ ok: true }>(`/rentals/${enc(id)}`),
      addFile: (id: string, file: Blob, fileName: string) => upload<StoredFile>(`/rentals/${enc(id)}/files`, file, fileName),
    },
    qc: { remove: (id: string) => del<{ ok: true }>(`/qc/${enc(id)}`) },
    subcontracts: { remove: (id: string) => del<{ ok: true }>(`/subcontracts/${enc(id)}`) },
    ap: {
      list: (f: { show?: 'inbox' | 'approval' | 'mine' | 'approved' | 'paid' | 'rejected' | 'hold' | 'all'; q?: string; siteId?: string; companyId?: string } = {}) => get<ApInvoiceSummary[]>('/ap', f),
      dashboard: () => get<ApDashboard>('/ap/dashboard'),
      /** The invoice with its receiving reports at the back */
      pack: (id: string) => requestBlob(`/ap/${enc(id)}/pack`),
      upload: (companyId: string, file: Blob, fileName: string) => upload<ApInvoiceDetail>(`/ap?companyId=${enc(companyId)}`, file, fileName),
      get: (id: string) => get<ApInvoiceDetail>(`/ap/${enc(id)}`),
      edit: (id: string, input: ApInvoiceEditInput) => patch<ApInvoiceDetail>(`/ap/${enc(id)}`, input),
      decide: (id: string, input: ApDecisionInput) => post<ApInvoiceDetail>(`/ap/${enc(id)}/decide`, input),
      action: (id: string, input: ApActionInput) => post<ApInvoiceDetail>(`/ap/${enc(id)}/action`, input),
      sendRejection: (id: string, input: { to?: string | null; handledManually?: boolean }) => post<ApInvoiceDetail>(`/ap/${enc(id)}/send-rejection`, input),
      payRuns: (companyId: string) => get<PayRunRow[]>('/ap/pay-runs', { companyId }),
      scanFolders: () => post<{ imported: number; problems: string[] }>('/ap/folders/scan'),
      settings: (companyId: string) => get<AccountingSettings>(`/companies/${enc(companyId)}/accounting`),
      saveSettings: (companyId: string, input: AccountingSettings) => put<AccountingSettings>(`/companies/${enc(companyId)}/accounting`, input),
    },
    projectMoney: {
      holdback: (siteId: string) => get<SubHoldbackView>(`/sites/${enc(siteId)}/holdback`),
      saveHoldback: (siteId: string, input: SubHoldbackInput) => put<SubHoldbackView>(`/sites/${enc(siteId)}/holdback`, input),
      budget: (siteId: string) => get<{ rows: BudgetRow[]; canEdit: boolean; totals: { budget: number; committed: number; actual: number } }>(`/sites/${enc(siteId)}/budget`),
      saveBudget: (siteId: string, input: JobBudgetInput) => put<{ rows: BudgetRow[]; canEdit: boolean; totals: { budget: number; committed: number; actual: number } }>(`/sites/${enc(siteId)}/budget`, input),
    },
    customers: {
      list: (f: { q?: string; companyId?: string; includeInactive?: boolean } = {}) => get<CustomerItem[]>('/customers', f),
      create: (input: CustomerInput) => post<{ id: string }>('/customers', input),
      update: (id: string, input: CustomerInput) => put<{ id: string }>(`/customers/${enc(id)}`, input),
    },
    ar: {
      list: (f: { state?: ArState | 'OPEN'; customerId?: string; siteId?: string; companyId?: string } = {}) => get<ArInvoiceSummary[]>('/ar', f),
      nextNumber: (companyId: string) => get<{ invoiceNumber: string }>('/ar/next-number', { companyId }),
      get: (id: string) => get<ArInvoiceDetail>(`/ar/${enc(id)}`),
      addBackup: (id: string, file: Blob, fileName: string) => upload<ArInvoiceDetail>(`/ar/${enc(id)}/backups`, file, fileName),
      removeBackup: (id: string, fileId: string) => del<ArInvoiceDetail>(`/ar/${enc(id)}/backups/${enc(fileId)}`),
      create: (input: ArInvoiceInput) => post<ArInvoiceDetail>('/ar', input),
      update: (id: string, input: ArInvoiceInput) => put<ArInvoiceDetail>(`/ar/${enc(id)}`, input),
      send: (id: string, email: boolean) => post<{ state: string; invoice: ArInvoiceDetail }>(`/ar/${enc(id)}/send`, { email }),
      void: (id: string) => post<ArInvoiceDetail>(`/ar/${enc(id)}/void`),
      pay: (id: string, input: { paidOn: string; amount: number; reference?: string | null; holdbackRelease?: boolean }) => post<ArInvoiceDetail>(`/ar/${enc(id)}/payments`, input),
      pdf: (id: string) => requestBlob(`/ar/${enc(id)}/pdf`),
    },
    accountingExport: (kind: 'ap' | 'ar' | 'tax', from: string, to: string, companyId?: string) => get<AccountingExportRow[]>('/accounting/export', { kind, from, to, companyId }),
    filing: {
      settings: (companyId: string) => get<FilingSettings>(`/companies/${enc(companyId)}/filing`),
      save: (companyId: string, input: FilingSettings) => put<FilingSettings>(`/companies/${enc(companyId)}/filing`, input),
      jobs: (show: 'pending' | 'failed' | 'done' = 'pending') => get<FilingJobView[]>('/filing/jobs', { show }),
      retry: () => post<{ requeued: number; done: number; failed: number }>('/filing/retry'),
      devices: () => get<SyncDeviceView[]>('/sync-devices'),
      addDevice: (name: string) => post<{ id: string; token: string }>('/sync-devices', { name }),
      removeDevice: (id: string) => del<{ ok: true }>(`/sync-devices/${enc(id)}`),
    },
    imports: {
      preview: (dataset: ImportDataset, file: Blob, fileName: string) => upload<GenericSheetPreview>(`/imports/preview?dataset=${enc(dataset)}`, file, fileName),
      run: (input: ImportInput) => post<ImportResult>('/imports', input),
    },
    exportMappings: {
      list: () => get<ExportMappingView[]>('/export-mappings'),
      create: (input: ExportMappingInput) => post<ExportMappingView>('/export-mappings', input),
      update: (id: string, input: ExportMappingInput) => put<ExportMappingView>(`/export-mappings/${enc(id)}`, input),
      remove: (id: string) => del<{ ok: true }>(`/export-mappings/${enc(id)}`),
      run: (id: string, from: string, to: string) => requestBlob(`/export-mappings/${enc(id)}/run`, { from, to }),
    },
    /** Everything the organization has, as one ZIP */
    dataExport: (includeFiles: boolean) => requestBlob('/data-export', { includeFiles }),
    ai: {
      status: () => get<AiStatus>('/ai/status'),
      settings: () => get<AiSettingsView>('/ai/settings'),
      saveSettings: (input: AiSettingsInput) => put<AiSettingsView>('/ai/settings', input),
      test: () => post<{ ok: boolean; message: string }>('/ai/test'),
      toggles: () => get<AiToggleRow[]>('/ai/toggles'),
      saveToggles: (input: AiToggleInput) => put<AiToggleRow[]>('/ai/toggles', input),
      usage: () => get<AiUsageRow[]>('/ai/usage'),
      log: () => get<AiLogRow[]>('/ai/log'),
      history: (days = 90) => get<AiTokenHistory>('/ai/history', { days: String(days) }),
      fill: (input: VoiceFillInput) => post<VoiceResult>('/ai/fill', input),
      navigate: (transcript: string, destinations: { path: string; label: string }[], screen?: NavigateInput['screen']) => post<VoiceResult>('/ai/navigate', { transcript, destinations, screen: screen ?? null }),
      transcribe: (audio: Blob) => upload<{ text: string }>('/ai/transcribe', audio, 'speech.webm'),
      readQuote: (file: Blob, fileName: string, companyId?: string) => upload<QuoteScanResult>(`/ai/quote${companyId ? `?companyId=${enc(companyId)}` : ''}`, file, fileName),
      readInvoice: (file: Blob, fileName: string, companyId?: string) => upload<InvoiceScanResult>(`/ai/invoice${companyId ? `?companyId=${enc(companyId)}` : ''}`, file, fileName),
    },
    purchaseOrders: {
      list: (f: { show?: 'open' | 'drafts' | 'approval' | 'overdue' | 'all'; q?: string; siteId?: string; equipmentId?: string; companyId?: string | null } = {}) =>
        get<PoSummary[]>('/purchase-orders', f),
      dashboard: () => get<PoDashboard>('/purchase-orders/dashboard'),
      nextNumber: (companyId: string) => get<{ poNumber: string }>('/purchase-orders/next-number', { companyId }),
      get: (id: string) => get<PoDetail>(`/purchase-orders/${enc(id)}`),
      create: (input: PoInput) => post<PoDetail>('/purchase-orders', input),
      update: (id: string, input: PoInput) => put<PoDetail>(`/purchase-orders/${enc(id)}`, input),
      remove: (id: string) => del<{ ok: true }>(`/purchase-orders/${enc(id)}`),
      issue: (id: string, emailVendor?: boolean) => post<PoDetail>(`/purchase-orders/${enc(id)}/issue`, { emailVendor }),
      decide: (id: string, input: PoApprovalInput) => post<PoDetail>(`/purchase-orders/${enc(id)}/approval`, input),
      cancel: (id: string) => post<PoDetail>(`/purchase-orders/${enc(id)}/cancel`),
      close: (id: string) => post<PoDetail>(`/purchase-orders/${enc(id)}/close`),
      reopen: (id: string) => post<PoDetail>(`/purchase-orders/${enc(id)}/reopen`),
      postLoad: (id: string, input: PostPoLoadInput) => post<{ bolId: string }>(`/purchase-orders/${enc(id)}/post-load`, input),
      setEta: (id: string, expectedDate: string | null) => put<PoDetail>(`/purchase-orders/${enc(id)}/eta`, { expectedDate }),
      sendToVendor: (id: string) => post<{ state: string; po: PoDetail }>(`/purchase-orders/${enc(id)}/send-vendor`),
      pdf: (id: string, packing = false) => requestBlob(`/purchase-orders/${enc(id)}/pdf${packing ? '?packing=1' : ''}`),
    },
    vendors: (companyId: string) => get<{ id: string; name: string; contactId: string | null }[]>(`/companies/${enc(companyId)}/vendors`),
    purchasing: {
      get: (companyId: string) => get<PurchasingSettings>(`/companies/${enc(companyId)}/purchasing`),
      save: (companyId: string, input: PurchasingSettings) => put<PurchasingSettings>(`/companies/${enc(companyId)}/purchasing`, input),
    },
    emailTemplates: {
      list: (companyId: string) => get<EmailTemplateView[]>(`/companies/${enc(companyId)}/email-templates`),
      save: (companyId: string, key: string, input: EmailTemplateInput) => put<EmailTemplateView[]>(`/companies/${enc(companyId)}/email-templates/${enc(key)}`, input),
      reset: (companyId: string, key: string) => del<EmailTemplateView[]>(`/companies/${enc(companyId)}/email-templates/${enc(key)}`),
    },
    outbox: {
      list: (show: 'review' | 'failed' | 'sent' = 'review') => get<OutboxItem[]>('/outbox', { show }),
      edit: (id: string, input: OutboxEditInput) => patch<OutboxItem>(`/outbox/${enc(id)}`, input),
      send: (id: string, input?: OutboxEditInput) => post<OutboxItem>(`/outbox/${enc(id)}/send`, input),
      discard: (id: string) => del<{ ok: true }>(`/outbox/${enc(id)}`),
    },
    /** Photo of any Bowron QR code → where to go */
    scan: (file: Blob, fileName: string) => upload<UniversalScanResult>('/scan', file, fileName),
    exports: {
      /** Any list → Excel / PDF file */
      table: (input: TableExportInput) => requestBlob('/exports/table', input),
    },
    equipment: {
      tags: (ids?: string[]) => requestBlob(`/equipment/tags${ids?.length ? `?ids=${ids.map(enc).join(',')}` : ''}`),
      list: (f: { q?: string; companyId?: string | null; siteId?: string; category?: string; includeInactive?: boolean } = {}) => get<EquipmentItem[]>('/equipment', f),
      get: (id: string) => get<EquipmentDetail>(`/equipment/${enc(id)}`),
      create: (input: EquipmentInput) => post<{ id: string }>('/equipment', input),
      update: (id: string, input: Partial<EquipmentInput>) => patch<{ id: string }>(`/equipment/${enc(id)}`, input),
      move: (id: string, input: EquipmentMoveInput) => post<EquipmentDetail>(`/equipment/${enc(id)}/move`, input),
      setPstForm: (id: string, file: Blob, fileName: string) => upload<{ fileId: string; url: string }>(`/equipment/${enc(id)}/pst-form`, file, fileName),
      removePstForm: (id: string) => del<{ fileId: null }>(`/equipment/${enc(id)}/pst-form`),
      previewImport: (file: Blob, fileName: string) => upload<SheetPreview>('/equipment/import/preview', file, fileName),
      import: (input: EquipmentImportInput) => post<EquipmentImportResult>('/equipment/import', input),
    },
    locations: {
      list: (f: { q?: string; includeInactive?: boolean } = {}) => get<LocationItem[]>('/locations', f),
      get: (id: string) => get<LocationItem>(`/locations/${enc(id)}`),
      /** auto = typed in while building a BOL */
      create: (input: LocationInput, auto = false) => post<LocationItem>(auto ? '/locations?source=auto' : '/locations', input),
      update: (id: string, input: Partial<LocationInput>) => patch<LocationItem>(`/locations/${enc(id)}`, input),
      remove: (id: string) => del<{ ok: true }>(`/locations/${enc(id)}`),
    },
    access: {
      get: () => get<AccessSettings>('/access'),
      save: (input: AccessSettings) => put<AccessSettings>('/access', input),
      /** A person's extra business units and what they may buy for */
      setUser: (userId: string, input: UserAccessInput) => put<{ ok: true }>(`/users/${enc(userId)}/access`, input),
    },
    nav: {
      save: (input: NavSettings) => put<NavSettings>('/nav', input),
      saveMine: (layout: NavLayout) => put<{ ok: true }>('/me/nav', layout),
      resetMine: () => del<{ ok: true }>('/me/nav'),
    },
    jobMaterials: (f: { siteId?: string; open?: boolean } = {}) => get<JobMaterialSummary[]>('/job-materials', { siteId: f.siteId, open: f.open ? '1' : undefined }),
    equipmentNeeds: {
      list: (f: { siteId?: string; from?: string; to?: string } = {}) => get<EquipmentNeedView[]>('/equipment-needs', f),
      create: (input: EquipmentNeedInput) => post<{ id: string }>('/equipment-needs', input),
      update: (id: string, input: EquipmentNeedInput) => put<{ id: string }>(`/equipment-needs/${enc(id)}`, input),
      remove: (id: string) => del<{ ok: true }>(`/equipment-needs/${enc(id)}`),
      priority: (siteId: string, priority: number) => put<{ ok: true }>(`/sites/${enc(siteId)}/equipment-priority`, { priority }),
    },
    board: {
      list: (f: { from?: string; to?: string; companyId?: string } = {}) => get<BoardLoad[]>('/load-board', f),
      settings: () => get<BoardSettings>('/load-board/settings'),
      saveSettings: (input: BoardSettings) => put<BoardSettings>('/load-board/settings', input),
      post: (input: PostLoadInput) => post<{ id: string }>('/load-board/post', input),
      priority: (bolId: string, priority: string) => put<{ ok: true }>(`/bols/${enc(bolId)}/priority`, { priority }),
      optimize: (input: Partial<OptimizeInput> & { from: string; to: string }) => post<SuggestedRun[]>('/loads/optimize', input),
      makeRun: (run: { companyId: string; pickupLocationId: string; trailerId: string | null; shipOn: string | null; needBy: string | null; drops: { siteId: string; locationId: string; needBy: string | null }[]; plan: { lotId: string; qty: number }[][] }) => post<{ ids: string[] }>('/loads/run', run),
      /** Pin a location from a map link, coordinates or address */
      pin: (locationId: string, text: string) => put<{ lat: number; lng: number; how: string }>(`/locations/${enc(locationId)}/pin`, { text }),
      importKml: (file: Blob, fileName: string) => upload<{ created: number; updated: number }>('/locations/kml', file, fileName),
    },
    shipVia: {
      list: (f: { companyId?: string; all?: boolean } = {}) => get<ShipViaView[]>('/ship-via', { companyId: f.companyId, all: f.all ? '1' : undefined }),
      create: (input: ShipViaInput) => post<ShipViaView>('/ship-via', input),
      update: (id: string, input: ShipViaInput) => put<ShipViaView>(`/ship-via/${enc(id)}`, input),
    },
    /** Where a job's POs can ship to: the job, its extra ship-tos, the yards */
    shipTo: (siteId: string) => get<LocationItem[]>(`/sites/${enc(siteId)}/ship-to`),
    /** Your own order list (Excel / CSV, any layout) → rows for the draft */
    importOrderSheet: (siteId: string, file: Blob, fileName: string) => upload<{ rows: DraftRow[]; how: 'columns' | 'guessed' | 'ai'; note: string | null }>(`/sites/${enc(siteId)}/order-import`, file, fileName),
    notifications: {
      list: (unread = false) => get<{ items: NotificationView[]; unread: number }>('/notifications', unread ? { unread: '1' } : {}),
      count: () => get<{ unread: number }>('/notifications/count'),
      read: (ids: string[] | 'all') => post<{ marked: number }>('/notifications', ids === 'all' ? { all: true } : { ids }),
    },
    activity: (f: { siteId?: string; limit?: number } = {}) => get<ActivityItem[]>('/activity', { siteId: f.siteId, limit: f.limit ? String(f.limit) : undefined }),
    search: (q: string) => get<SearchHit[]>('/search', { q }),
    dashboard: () => get<DashboardTile[]>('/dashboard'),
    appearance: (companyId: string, input: AppearanceInput, file: Blob | null, fileName?: string) => upload<{ ok: true }>(`/companies/${enc(companyId)}/appearance`, file, fileName, input),
    health: {
      get: () => get<{ settings: HealthSettings; runs: HealthRunView[] }>('/health'),
      save: (input: HealthSettings) => put<HealthSettings>('/health', input),
      run: () => post<HealthRunView>('/health/run'),
    },
    mfa: {
      setup: () => post<MfaSetup>('/auth/mfa/setup'),
      enable: (code: string) => post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code }),
      verify: (code: string) => post<{ ok: true; recoveryCodesLeft: number }>('/auth/mfa/verify', { code }),
      disable: (code: string) => post<{ ok: true }>('/auth/mfa/disable', { code }),
      resetFor: (userId: string) => post<{ ok: true }>(`/users/${enc(userId)}/mfa-reset`),
    },
    security: {
      settings: () => get<SecuritySettings>('/security/settings'),
      save: (input: SecuritySettings) => put<SecuritySettings>('/security/settings', input),
      events: (days = 30) => get<SecurityEvent[]>('/security/events', { days: String(days) }),
    },
    assistant: {
      ask: (input: AssistantAskInput) => post<AssistantReply>('/assistant/ask', input),
      conversations: () => get<{ id: string; title: string | null; updatedAt: string }[]>('/assistant/conversations'),
      conversation: (id: string) => get<AssistantConversationView>(`/assistant/conversations/${enc(id)}`),
      removeConversation: (id: string) => del<{ ok: true }>(`/assistant/conversations/${enc(id)}`),
      answer: (messageId: string, yes: boolean) => post<AssistantMessageView>(`/assistant/messages/${enc(messageId)}/answer`, { yes }),
      settings: () => get<AssistantSettings>('/assistant/settings'),
      saveSettings: (input: AssistantSettings) => put<AssistantSettings>('/assistant/settings', input),
    },
    nicknames: {
      list: () => get<NicknameView[]>('/nicknames'),
      save: (input: NicknameInput) => post<{ id: string }>('/nicknames', input),
      remove: (id: string) => del<{ ok: true }>(`/nicknames/${enc(id)}`),
    },
    suggestions: {
      items: (f: { q: string; siteId?: string; companyId?: string }) => get<ItemSuggestion[]>('/suggestions/items', f),
      po: (f: { companyId: string; vendorName?: string; description?: string }) => get<PoDefaults>('/suggestions/po', f),
      feedback: (f: Omit<SuggestionFeedback, 'contextKey'> & { contextKey?: string }) => post<{ ok: true }>('/suggestions/feedback', { contextKey: '', ...f }),
    },
    insights: (days = 90) => get<InsightsView>('/insights', { days: String(days) }),
    reports: {
      run: (key: ReportKey, f: { from: string; to: string; companyId?: string }) => get<ReportResult>(`/reports/${enc(key)}`, f),
      saved: () => get<SavedReportView[]>('/reports/saved'),
      create: (input: SavedReportInput) => post<{ id: string }>('/reports/saved', input),
      update: (id: string, input: SavedReportInput) => put<{ id: string }>(`/reports/saved/${enc(id)}`, input),
      remove: (id: string) => del<{ ok: true }>(`/reports/saved/${enc(id)}`),
      runSaved: (id: string) => requestBlob(`/reports/saved/${enc(id)}/run`, {}),
      preview: (input: SavedReportInput) => post<BuiltReportPreview>('/reports/build?preview=1', input),
      file: (input: SavedReportInput) => requestBlob('/reports/build', input),
      pmWeekly: () => get<PmWeeklySettings>('/reports/pm-weekly'),
      savePmWeekly: (input: PmWeeklySettings) => put<PmWeeklySettings>('/reports/pm-weekly', input),
    },
    meetings: {
      templates: (all = false) => get<MeetingTemplateView[]>('/meeting-templates', all ? { all: '1' } : {}),
      createTemplate: (input: MeetingTemplateInput) => post<MeetingTemplateView>('/meeting-templates', input),
      updateTemplate: (id: string, input: MeetingTemplateInput) => put<MeetingTemplateView>(`/meeting-templates/${enc(id)}`, input),
      list: (f: { siteId?: string; status?: string } = {}) => get<MeetingSummary[]>('/meetings', f),
      people: (f: { siteId?: string; companyId?: string }) => get<{ id: string; name: string; email: string }[]>('/meetings/people', f),
      get: (id: string) => get<MeetingDetail>(`/meetings/${enc(id)}`),
      create: (input: MeetingCreateInput) => post<MeetingDetail>('/meetings', input),
      update: (id: string, input: MeetingUpdateInput) => put<MeetingDetail>(`/meetings/${enc(id)}`, input),
      start: (id: string) => post<MeetingDetail>(`/meetings/${enc(id)}/start`),
      audio: (id: string, audio: Blob, fileName: string) => upload<{ transcribed: boolean; text: string | null }>(`/meetings/${enc(id)}/audio`, audio, fileName),
      suggest: (id: string) => post<{ summary: string; suggestions: SuggestedAction[] }>(`/meetings/${enc(id)}/suggest`),
      addAction: (id: string, input: ActionItemInput, fromAi = false) => post<ActionItemView>(`/meetings/${enc(id)}/actions${fromAi ? '?source=ai' : ''}`, input),
      finish: (id: string, email: boolean) => post<MeetingDetail & { emailed: number }>(`/meetings/${enc(id)}/finish`, { email }),
    },
    actionItems: {
      list: (f: { mine?: boolean; siteId?: string; status?: 'OPEN' | 'DONE' | 'ALL' } = {}) => get<ActionItemView[]>('/action-items', { ...f, mine: f.mine ? '1' : undefined }),
      update: (id: string, input: Partial<ActionItemInput>) => request<ActionItemView>('PATCH', `/action-items/${enc(id)}`, input),
    },
    trailers: {
      list: (all = false) => get<TrailerView[]>('/trailers', all ? { all: '1' } : {}),
      create: (input: TrailerInput) => post<TrailerView>('/trailers', input),
      update: (id: string, input: TrailerInput) => put<TrailerView>(`/trailers/${enc(id)}`, input),
    },
    loads: {
      items: (f: { locationId: string; siteId?: string; companyId?: string }) => get<LoadItem[]>('/loads/items', f),
      plan: (trailerId: string, items: { key: string; qty: number }[]) => post<LoadPlan & { items: LoadItem[] }>('/loads/plan', { trailerId, items }),
      compare: (items: { key: string; qty: number }[]) => post<{ trailerId: string; name: string; loads: number; flagged: number }[]>('/loads/compare', { items }),
      make: (input: MakeLoadsInput) => post<{ ids: string[] }>('/loads/make', input),
      /** Size and weight per unit on an order-list line */
      setSize: (orderLineId: string, input: LineSizeInput) => put<{ ok: true }>(`/order-lines/${enc(orderLineId)}/size`, input),
    },
    bols: {
      /** Job POs a BOL can be built from */
      poOptions: (companyId: string) => get<{ id: string; poNumber: string; vendorName: string; siteLabel: string | null; status: string }[]>('/bols/po-options', { companyId }),
      fromPo: (poId: string) => get<PoForBol>(`/bols/from-po/${enc(poId)}`),
      vendorPickup: (poId: string, lines: { poLineId: string; qty: number }[]) => post<{ locationId: string; lots: { lotId: string; poLineId: string; qty: number }[] }>(`/bols/from-po/${enc(poId)}/vendor-pickup`, { lines }),
      list: (f: { status?: 'open' | 'draft' | 'done'; siteId?: string; companyId?: string | null } = {}) => get<BolSummary[]>('/bols', f),
      get: (id: string) => get<BolDetail>(`/bols/${enc(id)}`),
      create: (input: BolInput) => post<BolDetail>('/bols', input),
      update: (id: string, input: BolInput) => put<BolDetail>(`/bols/${enc(id)}`, input),
      remove: (id: string) => del<{ ok: true }>(`/bols/${enc(id)}`),
      issue: (id: string, ship = false) => post<BolDetail>(`/bols/${enc(id)}/issue`, { ship }),
      /** The truck has left: tells everyone set up on the drop-off jobs */
      ship: (id: string) => post<BolDetail>(`/bols/${enc(id)}/ship`),
      cancel: (id: string) => post<BolDetail>(`/bols/${enc(id)}/cancel`),
      pdf: (id: string) => requestBlob(`/bols/${enc(id)}/pdf`),
      lookup: (q: string) => get<{ id: string; label: string }>('/bols/lookup', { q }),
      receive: (id: string, input: ReceiveBolInput) =>
        post<{ receiptId: string; problems: number; status: BolStatus }>(`/bols/${enc(id)}/receive`, input),
      receipt: (id: string) => get<SiteReceiptView>(`/bol-receipts/${enc(id)}`),
      addReceiptPhoto: (id: string, file: Blob, fileName: string) => {
        const form = new FormData();
        form.append('file', file, fileName);
        return post<{ id: string; url: string }>(`/bol-receipts/${enc(id)}/photos`, form);
      },
      /** Photo of a BOL → which BOL it is (QR code first, then the printed number) */
      scan: (file: Blob, fileName: string) => {
        const form = new FormData();
        form.append('file', file, fileName);
        return post<DocumentScanResult>('/bols/scan', form);
      },
      available: (locationId: string, companyId?: string) => get<AvailableLot[]>('/inventory/available', { locationId, companyId }),
      lotsAtSite: (siteId: string) => get<AvailableLot[]>(`/sites/${enc(siteId)}/lots`),
      createReturn: (input: ReturnInput) => post<BolDetail>('/returns', input),
      reschedule: (id: string, input: RescheduleInput) => post<ScheduleLoad>(`/bols/${enc(id)}/reschedule`, input),
    },
    schedule: {
      list: (f: ScheduleFilter) => get<ScheduleLoad[]>('/schedule', { ...f }),
    },
    recycleBin: {
      list: () => get<DeletedItem[]>('/recycle-bin'),
      restore: (id: string) => post<unknown>(`/recycle-bin/${enc(id)}/restore`),
    },
    orders: {
      list: (f: { siteId?: string; companyId?: string | null; status?: string } = {}) => get<OrderSummary[]>('/orders', f),
      create: (siteId: string) => post<{ id: string }>('/orders', { siteId }),
      get: (id: string) => get<OrderDetail>(`/orders/${enc(id)}`),
      saveDraft: (id: string, input: SaveDraftInput) => put<{ ok: true; savedAt: string }>(`/orders/${enc(id)}`, input),
      remove: (id: string) => del<{ ok: true }>(`/orders/${enc(id)}`),
      submit: (id: string) => post<SubmitResult>(`/orders/${enc(id)}/submit`),
      pdf: (id: string) => requestBlob(`/orders/${enc(id)}/pdf`),
      cancelLine: (id: string, lineId: string, reason: string | null) =>
        post<OrderDetail>(`/orders/${enc(id)}/lines/${enc(lineId)}/cancel`, { reason }),
    },
    siteInventory: (siteId: string) => get<SiteInventoryRow[]>(`/sites/${enc(siteId)}/inventory`),
    costCodes: {
      list: (companyId: string, siteId?: string) => get<CostCodeItem[]>(`/companies/${enc(companyId)}/cost-codes`, { siteId }),
      create: (companyId: string, input: CostCodeInput) => post<CostCodeItem>(`/companies/${enc(companyId)}/cost-codes`, input),
      remove: (companyId: string, id: string) => del<{ ok: true }>(`/companies/${enc(companyId)}/cost-codes/${enc(id)}`),
    },
    yard: {
      stockChecks: () => get<StockCheckOrder[]>('/yard/stock-check'),
      stockCheck: (orderId: string) => get<StockCheckOrder>(`/yard/stock-check/${enc(orderId)}`),
      saveStockCheck: (orderId: string, input: StockCheckInput) =>
        post<{ full: number; part: number; none: number }>(`/yard/stock-check/${enc(orderId)}`, input),
      incoming: (yardId?: string) => get<IncomingLine[]>('/yard/incoming', { yardId }),
      lookup: (q: string) => get<ReceivingLookup>('/yard/lookup', { q }),
      receive: (input: ReceiptInput) => post<{ id: string; problems: number }>('/yard/receipts', input),
      receipts: (yardId?: string) => get<ReceiptSummary[]>('/yard/receipts', { yardId }),
      receipt: (id: string) => get<ReceiptDetail>(`/yard/receipts/${enc(id)}`),
      addPhoto: (id: string, file: Blob, fileName: string) => {
        const form = new FormData();
        form.append('file', file, fileName);
        return post<{ id: string; url: string }>(`/yard/receipts/${enc(id)}/photos`, form);
      },
      inventory: (yardId?: string) => get<YardInventoryRow[]>('/yard/inventory', { yardId }),
      /** Photo of delivery papers → the PO / order / BOL it belongs to */
      scan: (file: Blob, fileName: string) => {
        const form = new FormData();
        form.append('file', file, fileName);
        return post<DocumentScanResult>('/yard/scan', form);
      },
    },
    procurement: {
      orders: (f: { show?: 'todo' | 'onorder' | 'all'; companyId?: string | null } = {}) => get<ProcurementOrderSummary[]>('/procurement/orders', f),
      order: (id: string) => get<ProcurementOrder>(`/procurement/orders/${enc(id)}`),
      rfq: (id: string, lineIds: string[], sent: boolean) => post<ProcurementOrder>(`/procurement/orders/${enc(id)}/rfq`, { lineIds, sent }),
      assignPo: (id: string, input: AssignPoInput) => post<ProcurementOrder>(`/procurement/orders/${enc(id)}/po`, input),
      updatePoLine: (poLineId: string, input: PoLineUpdate) => patch<ProcurementOrder>(`/procurement/po-lines/${enc(poLineId)}`, input),
      removePoLine: (poLineId: string) => del<ProcurementOrder>(`/procurement/po-lines/${enc(poLineId)}`),
      columns: (companyId: string) => get<CustomColumn[]>(`/companies/${enc(companyId)}/custom-columns`),
      createColumn: (companyId: string, input: CustomColumnInput) => post<CustomColumn>(`/companies/${enc(companyId)}/custom-columns`, input),
      updateColumn: (companyId: string, id: string, input: Partial<CustomColumnInput>) =>
        patch<CustomColumn>(`/companies/${enc(companyId)}/custom-columns/${enc(id)}`, input),
      deleteColumn: (companyId: string, id: string) => del<{ ok: true }>(`/companies/${enc(companyId)}/custom-columns/${enc(id)}`),
      setCustom: (lineId: string, columnId: string, value: CustomValue) =>
        put<{ value: CustomValue }>(`/order-lines/${enc(lineId)}/custom/${enc(columnId)}`, { value }),
    },
    subscribeEvents,
    geocode: (q: string) => get<GeocodeResult[]>('/geocode', { q }),
    platform: {
      listOrgs: () => get<OrgListItem[]>('/platform/organizations'),
      createOrg: (input: OrgCreateInput) => post<{ id: string }>('/platform/organizations', input),
      updateOrg: (id: string, input: OrgUpdateInput) => patch<{ ok: true }>(`/platform/organizations/${enc(id)}`, input),
      errors: (all = false) => get<ErrorEventView[]>('/errors', all ? { all: '1' } : {}),
      desktopRelease: () => get<{ version: string; notes: string; pubDate: string } | null>('/platform/desktop-release'),
      publishDesktopRelease: (installer: Blob, fileName: string, f: { version: string; notes: string; signature: string }) => {
        const form = new FormData();
        form.append('installer', installer, fileName);
        for (const [k, v] of Object.entries(f)) form.append(k, v);
        return request<{ ok: true; version: string }>('POST', '/platform/desktop-release', form);
      },
      resolveError: (id: string) => post<{ ok: true }>(`/errors/${enc(id)}/resolve`),
    },
    billing: {
      get: () => get<BillingView>('/billing'),
      checkout: (plan: 'STANDARD' | 'PRO', seats: number) => post<{ url: string }>('/billing/checkout', { plan, seats }),
      portal: () => post<{ url: string }>('/billing/portal'),
    },
    /** The apps report crashes (never throws). */
    reportError: (e: { message: string; stack?: string | null; path?: string | null }) => post<{ ok: true }>('/errors', e).catch(() => undefined),
    push: {
      register: (sub: PushSubscriptionInput) => post<{ ok: true }>('/push', sub),
      unregister: (endpoint: string) => request<{ ok: true }>('DELETE', '/push', { endpoint }),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
