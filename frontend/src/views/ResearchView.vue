<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";

const API_URL = "http://localhost:3000";

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const isLoading = ref(false);
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

  const formData = new FormData();
  formData.append("csv", selectedFile.value);

  try {
    const res = await fetch(`${API_URL}/research`, {
      method: "POST",
      body: formData
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `Request failed: ${res.status}`);
    }
    const blob = await res.blob();
    resultBlob.value = blob;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    isLoading.value = false;
  }
}

function restart() {
  selectedFile.value = null;
  resultBlob.value = null;
  error.value = null;
  if (fileInput.value) {
    fileInput.value.value = "";
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="w-full max-w-[520px] space-y-6">

      <div
        class="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 backdrop-blur-sm"
      >
        <input
          ref="fileInput"
          type="file"
          accept=".csv"
          class="block w-full text-sm text-zinc-400
                 file:mr-4 file:py-2.5 file:px-5
                 file:rounded-lg file:border-0
                 file:bg-zinc-800 file:text-zinc-300 file:font-medium file:text-sm
                 file:cursor-pointer
                 hover:file:bg-zinc-700
                 file:transition-colors file:duration-150
                 disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="isLoading"
          @change="onFileChange"
        />
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          class="flex-1 py-2.5 bg-white text-zinc-900 text-sm font-semibold rounded-lg
                 hover:bg-zinc-200
                 transition-colors duration-150
                 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
          :disabled="isLoading"
          @click="runResearch"
        >
          Research
        </button>
        <button
          type="button"
          class="flex-1 py-2.5 border border-zinc-700 text-zinc-400 text-sm font-medium rounded-lg
                 hover:border-zinc-600 hover:text-zinc-300
                 transition-colors duration-150
                 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-zinc-700 disabled:hover:text-zinc-400"
          :disabled="isLoading"
          @click="restart"
        >
          Restart
        </button>
      </div>

      <div
        v-if="isLoading || error || resultBlob"
        class="rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-4 text-sm"
      >
        <p v-if="isLoading" class="text-zinc-500">
          Researching&hellip;
        </p>
        <p v-else-if="error" class="text-red-400">
          {{ error }}
        </p>
        <div v-else-if="resultBlob" class="flex items-center justify-between">
          <span class="text-zinc-400">Results ready.</span>
          <a
            v-if="downloadUrl"
            :href="downloadUrl"
            download="results.csv"
            class="text-white font-medium hover:underline"
          >
            Download CSV
          </a>
        </div>
      </div>

    </div>
  </div>
</template>
