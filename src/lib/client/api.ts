'use client';

/** أدوات الاتصال بالـ API من المتصفح */

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public messageAr: string,
    public details?: unknown,
  ) {
    super(messageAr);
  }
  get isNetwork() {
    return this.code === 'NETWORK';
  }
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function parse<T>(res: Response): Promise<T> {
  let json: { ok: boolean; data?: T; error?: { code: string; message_ar: string; details?: unknown } } | null = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', res.status, 'استجابة غير متوقعة من الخادم');
  }
  if (!res.ok || !json?.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
      location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    }
    const e = json?.error;
    throw new ApiError(e?.code ?? 'ERROR', res.status, e?.message_ar ?? 'حدث خطأ', e?.details);
  }
  return json.data as T;
}

export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('NETWORK', 0, 'تعذر الاتصال بالخادم. تحقق من الإنترنت');
  }
  return parse<T>(res);
}

export async function apiSend<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Rasd-Request': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK', 0, 'تعذر الاتصال بالخادم. تحقق من الإنترنت');
  }
  return parse<T>(res);
}

/** رفع ملف (multipart) مع نفس حماية CSRF */
export async function apiUpload<T>(url: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'X-Rasd-Request': '1' }, body: form });
  } catch {
    throw new ApiError('NETWORK', 0, 'تعذر الاتصال بالخادم. تحقق من الإنترنت');
  }
  return parse<T>(res);
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ─── Offline queue (للسائق عند ضعف الشبكة) ─────────────────────

const QUEUE_KEY = 'rasd.offlineQueue.v1';

export interface QueuedRequest {
  id: string; // = idempotencyKey
  url: string;
  body: unknown;
  label: string;
  queuedAt: string;
}

export function readQueue(): QueuedRequest[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedRequest[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  window.dispatchEvent(new Event('rasd-queue'));
}

export function enqueue(item: QueuedRequest) {
  writeQueue([...readQueue().filter((q) => q.id !== item.id), item]);
}

/** يعيد إرسال الطلبات المعلقة بنفس مفتاح منع التكرار، فلا تتكرر حتى لو وصل الطلب الأول */
export async function flushQueue(): Promise<{ sent: number; failed: { item: QueuedRequest; error: string }[] }> {
  const items = readQueue();
  let sent = 0;
  const failed: { item: QueuedRequest; error: string }[] = [];
  const remaining: QueuedRequest[] = [];
  for (const item of items) {
    try {
      await apiSend('POST', item.url, item.body);
      sent++;
    } catch (err) {
      const e = err as ApiError;
      if (e.isNetwork) remaining.push(item);
      else failed.push({ item, error: e.messageAr });
    }
  }
  writeQueue(remaining);
  return { sent, failed };
}
