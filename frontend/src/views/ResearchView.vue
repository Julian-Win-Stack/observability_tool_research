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
  error.value = null;
  resultBlob.value = null;
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
        | { status: "done"; csv: string; warnings?: string[] }
        | { status: "error"; error: string };

      if (obj.status === "processing") {
        if (obj.message) progressMessage.value = obj.message;
        const incoming = obj.warnings ?? [];
        // Backend returns the full warnings array, so dedupe to avoid duplicates.
        warnings.value = Array.from(new Set([...warnings.value, ...incoming]));
        return "continue";
      }

      if (obj.status === "done") {
        const binary = atob(obj.csv);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        resultBlob.value = new Blob([bytes], { type: "text/csv" });
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
      const SLOW_INTERVAL_MS = 2500;
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

function restart() {
  abortControllerRef.value?.abort();
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
  error.value = null;
  progressMessage.value = null;
  warnings.value = [];
  isDragging.value = false;
  isLoading.value = false;
  if (fileInput.value) {
    fileInput.value.value = "";
  }
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

    <div class="w-full max-w-[396px]">
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
              <svg class="w-3 h-3 text-indigo-400 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
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
      </div>
    </div>
  </div>
</template>
