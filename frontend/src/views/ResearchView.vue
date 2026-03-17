<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";

const API_URL = "http://localhost:3000";

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const isLoading = ref(false);
const abortControllerRef = ref<AbortController | null>(null);
const resultBlob = ref<Blob | null>(null);
const error = ref<string | null>(null);
const downloadUrl = ref<string | null>(null);

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
  selectedFile.value = file ?? null;
  error.value = null;
  resultBlob.value = null;
}

async function runResearch() {
  if (!selectedFile.value) {
    error.value = "Please select a CSV file first.";
    return;
  }
  isLoading.value = true;
  error.value = null;
  resultBlob.value = null;
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
    const blob = await res.blob();
    resultBlob.value = blob;
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      error.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    isLoading.value = false;
  }
}

function restart() {
  abortControllerRef.value?.abort();
  selectedFile.value = null;
  resultBlob.value = null;
  error.value = null;
  isLoading.value = false;
  if (fileInput.value) {
    fileInput.value.value = "";
  }
}
</script>

<template>
  <div class="min-h-screen bg-[#0f1115] flex items-center justify-center p-4">
    <div class="w-full max-w-[396px]">
      <div
        class="rounded-lg border border-zinc-700/80 bg-[#161920] shadow-lg shadow-black/20 px-3.5 py-4.5 flex flex-col gap-3.5"
      >
        <!-- Custom file upload -->
        <label
          :class="[
            'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 min-h-[31px] rounded-md border border-dashed border-zinc-600/80 bg-[#12151a] px-2.5 py-2 cursor-pointer transition-all duration-200',
            isLoading
              ? 'opacity-50 pointer-events-none cursor-not-allowed'
              : 'hover:border-indigo-500/50 hover:bg-[#14171e] focus-within:ring-2 focus-within:ring-indigo-500/60 focus-within:ring-offset-1 focus-within:ring-offset-[#161920]'
          ]"
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
            {{ selectedFile ? "Change file" : "Choose file" }}
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

        <!-- Status -->
        <div
          v-if="isLoading || error || resultBlob"
          class="rounded-md border border-zinc-700/60 bg-[#12151a] px-2.5 py-2"
        >
          <div v-if="isLoading" class="flex items-center gap-2">
            <svg class="w-3 h-3 text-indigo-400 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span class="text-[13px] text-zinc-400">Researching&hellip;</span>
          </div>
          <p v-else-if="error" class="text-[13px] text-red-400">
            {{ error }}
          </p>
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
