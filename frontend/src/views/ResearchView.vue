<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";

const API_URL = import.meta.env.VITE_API_URL;
const showGuide = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const isLoading = ref(false);
const abortControllerRef = ref<AbortController | null>(null);
const pollingIntervalId = ref<number | null>(null);
const pollingSwitchTimeoutId = ref<number | null>(null);
const resultBlob = ref<Blob | null>(null);
const error = ref<string | null>(null);
const downloadUrl = ref<string | null>(null);
const progressMessage = ref<string | null>(null);
const warnings = ref<string[]>([]);
const isDragging = ref(false);
const batchJobId = ref<string | null>(null);
const batchResults = ref<Array<{ id: number; companyName: string; website: string; text: string }>>([]);

const singleCompanyName = ref("");
const singleWebsite = ref("");
const singleIsLoading = ref(false);
const singleAbortControllerRef = ref<AbortController | null>(null);
const singlePollingIntervalId = ref<number | null>(null);
const singlePollingSwitchTimeoutId = ref<number | null>(null);
const singleJobId = ref<string | null>(null);
const singleProgressMessage = ref<string | null>(null);
const singleWarnings = ref<string[]>([]);
const singleError = ref<string | null>(null);
const singleResults = ref<Array<{ id: number; text: string }>>([]);

type TextSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string };

function lineSegments(text: string): TextSegment[][] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const segments: TextSegment[] = [];
      const regex = /(https?:\/\/[^\s]+)/g;
      let last = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (start > last) {
          segments.push({ type: "text", value: line.slice(last, start) });
        }
        segments.push({ type: "link", value: match[0] });
        last = end;
      }

      if (last < line.length) {
        segments.push({ type: "text", value: line.slice(last) });
      }

      return segments.length > 0 ? segments : [{ type: "text", value: line }];
    });
}

function decodeCsvBase64(csvBase64: string): Blob {
  const binary = atob(csvBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "text/csv" });
}

function normalizeWebsiteInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    const hostname = parsed.hostname.trim().toLowerCase().replace(/^www\./, "");
    return hostname || null;
  } catch {
    return null;
  }
}

watch(resultBlob, (blob) => {
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value);
    downloadUrl.value = null;
  }
  if (blob) {
    downloadUrl.value = URL.createObjectURL(blob);
  }
});

onBeforeUnmount(() => {
  if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
  if (pollingIntervalId.value !== null) clearInterval(pollingIntervalId.value);
  if (pollingSwitchTimeoutId.value !== null) clearTimeout(pollingSwitchTimeoutId.value);
  if (singlePollingIntervalId.value !== null) clearInterval(singlePollingIntervalId.value);
  if (singlePollingSwitchTimeoutId.value !== null) clearTimeout(singlePollingSwitchTimeoutId.value);
  abortControllerRef.value?.abort();
  singleAbortControllerRef.value?.abort();
});

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  selectFile(file ?? null);
}

function selectFile(file: File | null) {
  if (file && !file.name.endsWith(".csv")) {
    error.value = "Please select a .csv file.";
    return;
  }
  selectedFile.value = file;
  error.value = null;
  resultBlob.value = null;
  batchResults.value = [];
  warnings.value = [];
}

function onDragOver(e: DragEvent) {
  e.preventDefault();
  if (!isLoading.value) isDragging.value = true;
}

function onDragLeave() {
  isDragging.value = false;
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  isDragging.value = false;
  if (isLoading.value) return;
  const file = e.dataTransfer?.files[0] ?? null;
  selectFile(file);
}

async function runResearch() {
  if (!selectedFile.value) {
    error.value = "Please select a CSV file first.";
    return;
  }

  // Stop any previous polling loop (if user clicks quickly).
  if (pollingIntervalId.value !== null) {
    clearInterval(pollingIntervalId.value);
    pollingIntervalId.value = null;
  }

  isLoading.value = true;
  batchJobId.value = null;
  error.value = null;
  resultBlob.value = null;
  batchResults.value = [];
  progressMessage.value = null;
  warnings.value = [];
  abortControllerRef.value = new AbortController();

  const formData = new FormData();
  formData.append("csv", selectedFile.value);

  try {
    const res = await fetch(`${API_URL}/research`, {
      method: "POST",
      body: formData,
      signal: abortControllerRef.value.signal
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `Request failed: ${res.status}`);
    }

    const start = (await res.json()) as { jobId?: string };
    if (!start.jobId) throw new Error("Server did not return a jobId");

    const jobId = start.jobId;
    batchJobId.value = jobId;

    const pollOnce = async (): Promise<"continue" | "stop"> => {
      const pollRes = await fetch(`${API_URL}/status/${jobId}`, {
        method: "GET",
        signal: abortControllerRef.value?.signal
      });

      if (pollRes.status === 404) {
        error.value = "Job not found. The server may have restarted.";
        return "stop";
      }

      if (!pollRes.ok) {
        const text = await pollRes.text().catch(() => "");
        throw new Error(text || `Request failed: ${pollRes.status}`);
      }

      const obj = (await pollRes.json()) as
        | { status: "processing"; message?: string; totalRows?: number; currentRow?: number; warnings?: string[] }
        | {
            status: "done";
            csv?: string;
            warnings?: string[];
            rows?: Array<{
              company_name: string;
              company_domain: string;
              observability_tool_research: string;
            }>;
          }
        | { status: "error"; error: string };

      if (obj.status === "processing") {
        if (obj.message) progressMessage.value = obj.message;
        const incoming = obj.warnings ?? [];
        // Backend returns the full warnings array, so dedupe to avoid duplicates.
        warnings.value = Array.from(new Set([...warnings.value, ...incoming]));
        return "continue";
      }

      if (obj.status === "done") {
        if (!obj.csv) throw new Error("Missing CSV payload for batch result");
        resultBlob.value = decodeCsvBase64(obj.csv);
        batchResults.value = (obj.rows ?? []).map((row, i) => ({
          id: Date.now() + i,
          companyName: row.company_name,
          website: row.company_domain,
          text: row.observability_tool_research
        }));
        progressMessage.value = null;
        return "stop";
      }

      // obj.status === "error"
      error.value = obj.error ?? "Unknown error";
      return "stop";
    };

    await new Promise<void>((resolve, reject) => {
      let pollingInFlight = false;
      const FAST_INTERVAL_MS = 1000;
      const SLOW_INTERVAL_MS = 3000;
      const FAST_PHASE_DURATION_MS = 30_000;

      const clearPolling = (): void => {
        if (pollingIntervalId.value !== null) {
          clearInterval(pollingIntervalId.value);
          pollingIntervalId.value = null;
        }
        if (pollingSwitchTimeoutId.value !== null) {
          clearTimeout(pollingSwitchTimeoutId.value);
          pollingSwitchTimeoutId.value = null;
        }
      };

      const startPollingInterval = (intervalMs: number): void => {
        if (pollingIntervalId.value !== null) {
          clearInterval(pollingIntervalId.value);
        }
        pollingIntervalId.value = window.setInterval(() => {
          if (pollingInFlight) return;
          pollingInFlight = true;
          void pollOnce()
            .then((shouldStop) => {
              if (shouldStop === "stop") stop();
            })
            .catch((e) => {
              reject(e);
            })
            .finally(() => {
              pollingInFlight = false;
            });
        }, intervalMs);
      };

      const stop = (): void => {
        clearPolling();
        resolve();
      };

      startPollingInterval(FAST_INTERVAL_MS);
      pollingSwitchTimeoutId.value = window.setTimeout(() => {
        startPollingInterval(SLOW_INTERVAL_MS);
        pollingSwitchTimeoutId.value = null;
      }, FAST_PHASE_DURATION_MS);

      // First poll immediately so UI updates sooner.
      void pollOnce()
        .then((shouldStop) => {
          if (shouldStop === "stop") stop();
        })
        .catch((e) => reject(e));
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      error.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    isLoading.value = false;
    batchJobId.value = null;
    progressMessage.value = null;
    if (pollingIntervalId.value !== null) {
      clearInterval(pollingIntervalId.value);
      pollingIntervalId.value = null;
    }
    if (pollingSwitchTimeoutId.value !== null) {
      clearTimeout(pollingSwitchTimeoutId.value);
      pollingSwitchTimeoutId.value = null;
    }
  }
}

async function runSingleResearch() {
  const companyName = singleCompanyName.value.trim();
  if (!companyName) {
    singleError.value = "Please enter company name.";
    return;
  }

  const normalizedDomain = normalizeWebsiteInput(singleWebsite.value);
  if (!normalizedDomain) {
    singleError.value = "Please enter a valid domain or URL.";
    return;
  }

  if (singlePollingIntervalId.value !== null) {
    clearInterval(singlePollingIntervalId.value);
    singlePollingIntervalId.value = null;
  }
  if (singlePollingSwitchTimeoutId.value !== null) {
    clearTimeout(singlePollingSwitchTimeoutId.value);
    singlePollingSwitchTimeoutId.value = null;
  }

  singleIsLoading.value = true;
  singleError.value = null;
  singleProgressMessage.value = null;
  singleWarnings.value = [];
  singleAbortControllerRef.value = new AbortController();

  try {
    const res = await fetch(`${API_URL}/research/single`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName, companyDomain: normalizedDomain }),
      signal: singleAbortControllerRef.value.signal
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `Request failed: ${res.status}`);
    }

    const start = (await res.json()) as { jobId?: string };
    if (!start.jobId) throw new Error("Server did not return a jobId");
    singleJobId.value = start.jobId;

    const pollOnce = async (): Promise<"continue" | "stop"> => {
      if (!singleJobId.value) return "stop";
      const pollRes = await fetch(`${API_URL}/status/${singleJobId.value}`, {
        method: "GET",
        signal: singleAbortControllerRef.value?.signal
      });

      if (pollRes.status === 404) {
        singleError.value = "Job not found. The server may have restarted.";
        return "stop";
      }

      if (!pollRes.ok) {
        const text = await pollRes.text().catch(() => "");
        throw new Error(text || `Request failed: ${pollRes.status}`);
      }

      const obj = (await pollRes.json()) as
        | { status: "processing"; message?: string; warnings?: string[] }
        | { status: "done"; result?: string; warnings?: string[] }
        | { status: "error"; error: string };

      if (obj.status === "processing") {
        if (obj.message) singleProgressMessage.value = obj.message;
        const incoming = obj.warnings ?? [];
        singleWarnings.value = Array.from(new Set([...singleWarnings.value, ...incoming]));
        return "continue";
      }

      if (obj.status === "done") {
        const result = (obj.result ?? "").trim() || "Not found";
        singleResults.value = [{ id: Date.now(), text: result }, ...singleResults.value];
        singleProgressMessage.value = null;
        return "stop";
      }

      singleError.value = obj.error ?? "Unknown error";
      return "stop";
    };

    await new Promise<void>((resolve, reject) => {
      let pollingInFlight = false;
      const FAST_INTERVAL_MS = 1000;
      const SLOW_INTERVAL_MS = 3000;
      const FAST_PHASE_DURATION_MS = 30_000;

      const clearPolling = (): void => {
        if (singlePollingIntervalId.value !== null) {
          clearInterval(singlePollingIntervalId.value);
          singlePollingIntervalId.value = null;
        }
        if (singlePollingSwitchTimeoutId.value !== null) {
          clearTimeout(singlePollingSwitchTimeoutId.value);
          singlePollingSwitchTimeoutId.value = null;
        }
      };

      const startPollingInterval = (intervalMs: number): void => {
        if (singlePollingIntervalId.value !== null) {
          clearInterval(singlePollingIntervalId.value);
        }
        singlePollingIntervalId.value = window.setInterval(() => {
          if (pollingInFlight) return;
          pollingInFlight = true;
          void pollOnce()
            .then((shouldStop) => {
              if (shouldStop === "stop") stop();
            })
            .catch((e) => reject(e))
            .finally(() => {
              pollingInFlight = false;
            });
        }, intervalMs);
      };

      const stop = (): void => {
        clearPolling();
        resolve();
      };

      startPollingInterval(FAST_INTERVAL_MS);
      singlePollingSwitchTimeoutId.value = window.setTimeout(() => {
        startPollingInterval(SLOW_INTERVAL_MS);
        singlePollingSwitchTimeoutId.value = null;
      }, FAST_PHASE_DURATION_MS);

      void pollOnce()
        .then((shouldStop) => {
          if (shouldStop === "stop") stop();
        })
        .catch((e) => reject(e));
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      singleError.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    singleIsLoading.value = false;
    singleProgressMessage.value = null;
    if (singlePollingIntervalId.value !== null) {
      clearInterval(singlePollingIntervalId.value);
      singlePollingIntervalId.value = null;
    }
    if (singlePollingSwitchTimeoutId.value !== null) {
      clearTimeout(singlePollingSwitchTimeoutId.value);
      singlePollingSwitchTimeoutId.value = null;
    }
    singleJobId.value = null;
  }
}

function restart() {
  abortControllerRef.value?.abort();
  if (batchJobId.value) {
    void fetch(`${API_URL}/cancel/${batchJobId.value}`, { method: "POST" }).catch(() => undefined);
  }
  if (pollingIntervalId.value !== null) {
    clearInterval(pollingIntervalId.value);
    pollingIntervalId.value = null;
  }
  if (pollingSwitchTimeoutId.value !== null) {
    clearTimeout(pollingSwitchTimeoutId.value);
    pollingSwitchTimeoutId.value = null;
  }
  selectedFile.value = null;
  resultBlob.value = null;
  batchResults.value = [];
  error.value = null;
  progressMessage.value = null;
  warnings.value = [];
  isDragging.value = false;
  isLoading.value = false;
  if (fileInput.value) {
    fileInput.value.value = "";
  }
  batchJobId.value = null;
}

function restartSingle() {
  singleAbortControllerRef.value?.abort();
  if (singleJobId.value) {
    void fetch(`${API_URL}/cancel/${singleJobId.value}`, { method: "POST" }).catch(() => undefined);
  }
  if (singlePollingIntervalId.value !== null) {
    clearInterval(singlePollingIntervalId.value);
    singlePollingIntervalId.value = null;
  }
  if (singlePollingSwitchTimeoutId.value !== null) {
    clearTimeout(singlePollingSwitchTimeoutId.value);
    singlePollingSwitchTimeoutId.value = null;
  }
  singleCompanyName.value = "";
  singleWebsite.value = "";
  singleError.value = null;
  singleWarnings.value = [];
  singleProgressMessage.value = null;
  singleIsLoading.value = false;
  singleJobId.value = null;
}
</script>

<template>
  <div class="min-h-screen bg-[#0f1115] flex items-center justify-center p-4">
    <!-- Help toggle -->
    <button
      type="button"
      class="fixed top-4 right-4 z-50 w-7 h-7 rounded-full border border-zinc-600/80 bg-[#161920] text-zinc-400 text-[13px] font-medium
             hover:border-indigo-500/50 hover:text-indigo-400 hover:bg-[#1a1e28]
             focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
             transition-all duration-150 flex items-center justify-center"
      @click="showGuide = !showGuide"
    >?</button>

    <!-- Guide panel -->
    <transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      enter-from-class="opacity-0 translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="showGuide"
        class="fixed top-14 right-4 z-40 w-[320px] rounded-lg border border-zinc-700/80 bg-[#161920] shadow-xl shadow-black/30 px-4 py-4"
      >
        <h3 class="text-[13px] font-semibold text-zinc-200 mb-2">Using Your Own Company List</h3>
        <p class="text-[12px] text-zinc-400 leading-relaxed mb-3">
          You can also use this tool for companies that aren't directly downloaded from Apollo.
        </p>
        <p class="text-[12px] text-zinc-400 mb-1.5">To do this:</p>
        <ol class="text-[12px] text-zinc-400 leading-relaxed space-y-1.5 list-decimal list-inside mb-3">
          <li>Create a spreadsheet with exactly these two column names:
            <span class="inline-flex gap-1.5 mt-1 ml-1">
              <code class="px-1.5 py-0.5 rounded bg-zinc-800 text-indigo-400 text-[11px] font-mono">Company Name</code>
              <code class="px-1.5 py-0.5 rounded bg-zinc-800 text-indigo-400 text-[11px] font-mono">Website</code>
            </span>
          </li>
          <li>Add your list of companies under those columns</li>
          <li>Export the file as a CSV</li>
          <li>Upload the CSV into the app and run the research as usual</li>
        </ol>
        <p class="text-[11px] text-zinc-500 leading-relaxed border-t border-zinc-700/60 pt-2.5">
          Make sure the column names match exactly, otherwise the app won't recognize them.
        </p>
      </div>
    </transition>

    <div class="w-full max-w-[420px] flex flex-col gap-3">
      <div
        class="rounded-lg border border-zinc-700/80 bg-[#161920] shadow-lg shadow-black/20 px-3.5 py-4.5 flex flex-col gap-3.5"
      >
        <!-- Custom file upload with drag-and-drop -->
        <label
          :class="[
            'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 min-h-[31px] rounded-md border border-dashed bg-[#12151a] px-2.5 py-2 cursor-pointer transition-all duration-200',
            isDragging
              ? 'border-indigo-500 bg-[#14171e]'
              : isLoading
                ? 'border-zinc-600/80 opacity-50 pointer-events-none cursor-not-allowed'
                : 'border-zinc-600/80 hover:border-indigo-500/50 hover:bg-[#14171e] focus-within:ring-2 focus-within:ring-indigo-500/60 focus-within:ring-offset-1 focus-within:ring-offset-[#161920]'
          ]"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
        >
          <input
            ref="fileInput"
            type="file"
            accept=".csv"
            class="sr-only"
            :disabled="isLoading"
            @change="onFileChange"
          />
          <span class="text-[13px] font-medium text-indigo-400">
            {{ isDragging ? "Drop CSV here" : selectedFile ? "Change file" : "Choose or drop file" }}
          </span>
          <span class="text-[13px] text-zinc-500 truncate">
            {{ selectedFile ? selectedFile.name : "No file selected" }}
          </span>
        </label>

        <!-- Action buttons -->
        <div class="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            class="flex-1 min-h-[24px] px-3 py-1.5 rounded-md border border-zinc-600 bg-transparent text-zinc-400 text-[13px] font-medium
                   hover:border-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#161920]
                   active:scale-[0.98] transition-all duration-150"
            @click="restart"
          >
            Restart
          </button>
          <button
            type="button"
            class="flex-1 min-h-[24px] px-3 py-1.5 rounded-md bg-indigo-600 text-white text-[13px] font-semibold
                   hover:bg-indigo-500 active:bg-indigo-700
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#161920]
                   active:scale-[0.98] transition-all duration-150
                   disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
            :disabled="isLoading"
            @click="runResearch"
          >
            Research
          </button>
        </div>

        <!-- Warnings -->
        <div
          v-if="warnings.length > 0"
          class="rounded-md border border-amber-700/40 bg-amber-950/20 px-2.5 py-2 flex flex-col gap-1"
        >
          <p v-for="(w, i) in warnings" :key="i" class="text-[12px] text-amber-400 leading-relaxed">
            {{ w }}
          </p>
        </div>

        <!-- Status -->
        <div
          v-if="isLoading || error || resultBlob"
          class="rounded-md border border-zinc-700/60 bg-[#12151a] px-2.5 py-2 flex flex-col gap-2"
        >
          <p v-if="error" class="text-[13px] text-red-400">
            {{ error }}
          </p>
          <template v-else-if="isLoading">
            <div class="flex items-center gap-2">
              <svg class="w-3 h-3 text-indigo-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span class="text-[13px] text-zinc-400">Researching&hellip;</span>
            </div>
            <p v-if="progressMessage" class="text-[13px] text-zinc-500 truncate">
              {{ progressMessage }}
            </p>
          </template>
          <div
            v-else-if="resultBlob"
            class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5"
          >
            <span class="text-[13px] text-zinc-400">Results ready.</span>
            <a
              v-if="downloadUrl"
              :href="downloadUrl"
              download="results.csv"
              class="text-[13px] font-medium text-indigo-400 hover:text-indigo-300
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#12151a] rounded px-1.5 py-1 -mx-1.5 -my-1"
            >
              Download CSV
            </a>
          </div>
        </div>

        <div v-if="batchResults.length > 0" class="rounded-md border border-zinc-700/60 bg-[#12151a] px-2.5 py-2 flex flex-col gap-2">
          <p class="text-[12px] font-medium text-zinc-300">Batch results preview</p>
          <div class="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
            <div
              v-for="entry in batchResults"
              :key="entry.id"
              class="rounded-md border border-zinc-700/70 bg-[#0f1217] px-2.5 py-2 flex flex-col gap-1"
            >
              <p class="text-[11px] text-zinc-500">{{ entry.companyName }} — {{ entry.website }}</p>
              <div class="text-[12px] text-zinc-300 leading-relaxed">
                <p v-for="(segments, lineIdx) in lineSegments(entry.text)" :key="lineIdx">
                  <template v-for="(segment, segIdx) in segments" :key="`${lineIdx}-${segIdx}`">
                    <a
                      v-if="segment.type === 'link'"
                      :href="segment.value"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-400/60 underline-offset-2"
                    >
                      {{ segment.value }}
                    </a>
                    <span v-else>{{ segment.value }}</span>
                  </template>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        class="rounded-lg border border-zinc-700/80 bg-[#161920] shadow-lg shadow-black/20 px-3.5 py-4.5 flex flex-col gap-3.5"
      >
        <div class="flex flex-col gap-2">
          <label class="text-[12px] text-zinc-400">Company name</label>
          <input
            v-model="singleCompanyName"
            type="text"
            class="min-h-[31px] rounded-md border border-zinc-600/80 bg-[#12151a] px-2.5 py-2 text-[13px] text-zinc-200
                   placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#161920]"
            placeholder="Railway (case insensitive)"
            :disabled="singleIsLoading"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="text-[12px] text-zinc-400">Website</label>
          <input
            v-model="singleWebsite"
            type="text"
            class="min-h-[31px] rounded-md border border-zinc-600/80 bg-[#12151a] px-2.5 py-2 text-[13px] text-zinc-200
                   placeholder:text-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#161920]"
            placeholder="railway.com or https://railway.com/"
            :disabled="singleIsLoading"
          />
        </div>

        <div class="flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            class="flex-1 min-h-[24px] px-3 py-1.5 rounded-md border border-zinc-600 bg-transparent text-zinc-400 text-[13px] font-medium
                   hover:border-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#161920]
                   active:scale-[0.98] transition-all duration-150"
            @click="restartSingle"
          >
            Restart
          </button>
          <button
            type="button"
            class="flex-1 min-h-[24px] px-3 py-1.5 rounded-md bg-indigo-600 text-white text-[13px] font-semibold
                   hover:bg-indigo-500 active:bg-indigo-700
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 focus-visible:ring-offset-[#161920]
                   active:scale-[0.98] transition-all duration-150
                   disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
            :disabled="singleIsLoading"
            @click="runSingleResearch"
          >
            Research
          </button>
        </div>

        <div
          v-if="singleWarnings.length > 0"
          class="rounded-md border border-amber-700/40 bg-amber-950/20 px-2.5 py-2 flex flex-col gap-1"
        >
          <p v-for="(w, i) in singleWarnings" :key="`single-warning-${i}`" class="text-[12px] text-amber-400 leading-relaxed">
            {{ w }}
          </p>
        </div>

        <div
          v-if="singleIsLoading || singleError"
          class="rounded-md border border-zinc-700/60 bg-[#12151a] px-2.5 py-2 flex flex-col gap-2"
        >
          <p v-if="singleError" class="text-[13px] text-red-400">
            {{ singleError }}
          </p>
          <template v-else-if="singleIsLoading">
            <div class="flex items-center gap-2">
              <svg class="w-3 h-3 text-indigo-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <span class="text-[13px] text-zinc-400">Researching&hellip;</span>
            </div>
            <p v-if="singleProgressMessage" class="text-[13px] text-zinc-500 truncate">
              {{ singleProgressMessage }}
            </p>
          </template>
        </div>

        <div v-if="singleResults.length > 0" class="rounded-md border border-zinc-700/60 bg-[#12151a] px-2.5 py-2 flex flex-col gap-2">
          <p class="text-[12px] font-medium text-zinc-300">Recent results</p>
          <div class="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
            <div
              v-for="entry in singleResults"
              :key="entry.id"
              class="rounded-md border border-zinc-700/70 bg-[#0f1217] px-2.5 py-2"
            >
              <div class="text-[12px] text-zinc-300 whitespace-pre-wrap leading-relaxed wrap-break-word">
                <p v-for="(segments, lineIdx) in lineSegments(entry.text)" :key="lineIdx">
                  <template v-for="(segment, segIdx) in segments" :key="`${lineIdx}-${segIdx}`">
                    <a
                      v-if="segment.type === 'link'"
                      :href="segment.value"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-400/60 underline-offset-2"
                    >
                      {{ segment.value }}
                    </a>
                    <span v-else>{{ segment.value }}</span>
                  </template>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
