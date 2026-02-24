if (typeof tailwind !== "undefined") {
  tailwind.config = {
    theme: {
      extend: {
        fontFamily: {
          sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        },
      },
    },
  };
}

document.addEventListener("DOMContentLoaded", () => {
  const STRIPE_CHECKOUT_URLS = {
    plus: "https://buy.stripe.com/REPLACE_WITH_PLUS_LINK",
    pro: "https://buy.stripe.com/REPLACE_WITH_PRO_LINK",
  };

  const STORAGE_KEY = "openstep-billing-state-v1";
  const DEEPSEEK_API_KEY_STORAGE_KEY = "openstep-deepseek-api-key-v1";
  const DEEPSEEK_MODEL = "DeepSeek-V3.2";
  const DEEPSEEK_MAX_OUTPUT_TOKENS = 4096;
  const PLAN_CONFIG = {
    free: { name: "Free", monthlyCredits: 10, priceLabel: "$0/mo", speedLabel: "standard speed", solveDurationMs: 3400 },
    plus: { name: "Plus", monthlyCredits: 250, priceLabel: "$4.99/mo", speedLabel: "fast speed", solveDurationMs: 2000 },
    pro: { name: "Pro", monthlyCredits: 500, priceLabel: "$19.99/mo", speedLabel: "fastest speed", solveDurationMs: 1100 },
  };

  const solveStatusSteps = [
    "Scanning image...",
    "Identifying equations...",
    "Calculating step-by-step solution...",
    "Finalizing answer...",
  ];

  const el = {
    dropzone: document.getElementById("uploadDropzone"),
    fileInput: document.getElementById("fileInput"),
    previewImage: document.getElementById("previewImage"),
    uploadIcon: document.getElementById("uploadIcon"),
    uploadTitle: document.getElementById("uploadTitle"),
    uploadHint: document.getElementById("uploadHint"),
    cropBtn: document.getElementById("cropBtn"),
    resetBtn: document.getElementById("resetBtn"),
    solveBtn: document.getElementById("solveBtn"),
    creditLabel: document.getElementById("creditLabel"),
    planBadge: document.getElementById("planBadge"),
    creditCount: document.getElementById("creditCount"),
    solutionSkeleton: document.getElementById("solutionSkeleton"),
    solutionStatusText: document.getElementById("solutionStatusText"),
    solutionStatusList: document.getElementById("solutionStatusList"),
    solutionResult: document.getElementById("solutionResult"),
    solutionText: document.getElementById("solutionText"),
    solutionEmpty: document.getElementById("solutionEmpty"),
    exportNotesBtn: document.getElementById("exportNotesBtn"),
    exportPdfBtn: document.getElementById("exportPdfBtn"),
    toast: document.getElementById("toast"),
    upgradeBtn: document.getElementById("upgradeBtn"),
    upgradeModal: document.getElementById("upgradeModal"),
    closeUpgradeModalBtn: document.getElementById("closeUpgradeModalBtn"),
    stripeCheckoutPlusBtn: document.getElementById("stripeCheckoutPlusBtn"),
    stripeCheckoutProBtn: document.getElementById("stripeCheckoutProBtn"),
  };

  if (!el.fileInput || !el.dropzone || !el.solveBtn) {
    return;
  }

  const getCycleKey = (date = new Date()) => {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${date.getFullYear()}-${month}`;
  };

  const getDefaultBillingState = () => ({
    plan: "free",
    credits: PLAN_CONFIG.free.monthlyCredits,
    cycleKey: getCycleKey(),
  });

  const loadBillingState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return getDefaultBillingState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Object.prototype.hasOwnProperty.call(PLAN_CONFIG, parsed.plan)) {
        return getDefaultBillingState();
      }
      return {
        plan: parsed.plan,
        credits: Number.isFinite(parsed.credits) ? parsed.credits : PLAN_CONFIG[parsed.plan].monthlyCredits,
        cycleKey: typeof parsed.cycleKey === "string" ? parsed.cycleKey : getCycleKey(),
      };
    } catch {
      return getDefaultBillingState();
    }
  };

  const saveBillingState = (billingState) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(billingState));
  };

  const refreshCycleCreditsIfNeeded = (billingState) => {
    const currentCycle = getCycleKey();
    if (billingState.cycleKey === currentCycle) return billingState;
    return { plan: billingState.plan, cycleKey: currentCycle, credits: PLAN_CONFIG[billingState.plan].monthlyCredits };
  };

  const billingState = refreshCycleCreditsIfNeeded(loadBillingState());
  if (billingState.plan === "free") {
    // Demo behavior requested earlier.
    billingState.credits = PLAN_CONFIG.free.monthlyCredits;
  }
  saveBillingState(billingState);

  const state = {
    plan: billingState.plan,
    credits: billingState.credits,
    currentImageDataUrl: "",
    originalImageDataUrl: "",
    currentFileName: "",
    latestSolutionText: "",
  };

  let toastTimeoutId = null;
  let solveTimeoutId = null;
  let solveStatusIntervalId = null;

  const showToast = (message, isError = false) => {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.add("toast-visible");
    el.toast.classList.toggle("border-red-700", isError);
    el.toast.classList.toggle("text-red-200", isError);
    el.toast.classList.toggle("border-zinc-700", !isError);
    el.toast.classList.toggle("text-zinc-100", !isError);
    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    toastTimeoutId = setTimeout(() => el.toast.classList.remove("toast-visible"), 2200);
  };

  const updatePlanUI = () => {
    const planName = PLAN_CONFIG[state.plan].name;
    if (el.planBadge) el.planBadge.textContent = planName;
    if (el.creditLabel) el.creditLabel.textContent = `${planName} Credits:`;
  };

  const persistBillingState = () => {
    saveBillingState({
      plan: state.plan,
      credits: state.credits,
      cycleKey: getCycleKey(),
    });
  };

  const updateCredits = () => {
    if (el.creditCount) el.creditCount.textContent = String(state.credits);
    if (state.credits <= 0) {
      el.solveBtn.disabled = true;
      el.solveBtn.classList.add("cursor-not-allowed", "opacity-50");
    } else {
      el.solveBtn.disabled = false;
      el.solveBtn.classList.remove("cursor-not-allowed", "opacity-50");
    }
    persistBillingState();
    updatePlanUI();
  };

  const clearSolveStatusTimer = () => {
    if (solveStatusIntervalId) {
      clearInterval(solveStatusIntervalId);
      solveStatusIntervalId = null;
    }
  };

  const setActiveSolveStep = (activeIndex) => {
    if (el.solutionStatusText) {
      el.solutionStatusText.textContent = solveStatusSteps[Math.min(activeIndex, solveStatusSteps.length - 1)];
    }
    if (!el.solutionStatusList) return;
    const statusItems = el.solutionStatusList.querySelectorAll("li[data-step]");
    statusItems.forEach((item) => {
      const stepIndex = Number(item.getAttribute("data-step"));
      const isComplete = stepIndex < activeIndex;
      const isActive = stepIndex === activeIndex;
      item.classList.toggle("is-complete", isComplete);
      item.classList.toggle("is-active", isActive);
    });
  };

  const setPreview = (dataUrl, fileName) => {
    state.currentImageDataUrl = dataUrl;
    if (!state.originalImageDataUrl) state.originalImageDataUrl = dataUrl;
    state.currentFileName = fileName || state.currentFileName || "homework-image";
    if (el.previewImage) {
      el.previewImage.src = dataUrl;
      el.previewImage.classList.remove("hidden");
    }
    if (el.uploadIcon) el.uploadIcon.classList.add("hidden");
    if (el.uploadTitle) el.uploadTitle.textContent = "Image Ready";
    if (el.uploadHint) el.uploadHint.textContent = state.currentFileName;
  };

  const getImageFromDataUrl = (dataUrl) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });

  const cropCenterSquare = async () => {
    if (!state.currentImageDataUrl) {
      showToast("Upload an image first.", true);
      return;
    }
    const image = await getImageFromDataUrl(state.currentImageDataUrl);
    const side = Math.min(image.width, image.height);
    const startX = Math.floor((image.width - side) / 2);
    const startY = Math.floor((image.height - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, startX, startY, side, side, 0, 0, side, side);
    setPreview(canvas.toDataURL("image/png"), state.currentFileName);
    showToast("Center crop applied.");
  };

  const renderSolutionHtml = ({ problem, steps }) => {
    const esc = (text) => text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const stepHtml = steps
      .map((step, index) => `<div class="solution-line solution-step"><span class="solution-line-title">Step ${index + 1}:</span> ${esc(step)}</div>`)
      .join("");
    return `<div class="solution-line solution-line-title">Detected Problem: ${esc(problem)}</div>${stepHtml}`;
  };

  const setSolutionLoading = (solveDurationMs) => {
    if (el.solutionEmpty) el.solutionEmpty.classList.add("hidden");
    if (el.solutionResult) el.solutionResult.classList.add("hidden");
    if (el.solutionSkeleton) el.solutionSkeleton.classList.remove("hidden");
    clearSolveStatusTimer();
    let stepIndex = 0;
    setActiveSolveStep(stepIndex);
    const intervalMs = Math.max(250, Math.floor(solveDurationMs / (solveStatusSteps.length - 1)));
    solveStatusIntervalId = setInterval(() => {
      stepIndex += 1;
      setActiveSolveStep(Math.min(stepIndex, solveStatusSteps.length - 1));
      if (stepIndex >= solveStatusSteps.length - 1) clearSolveStatusTimer();
    }, intervalMs);
  };

  const setSolutionResult = (solution) => {
    clearSolveStatusTimer();
    if (el.solutionSkeleton) el.solutionSkeleton.classList.add("hidden");
    if (el.solutionEmpty) el.solutionEmpty.classList.add("hidden");
    if (el.solutionResult) el.solutionResult.classList.remove("hidden");
    if (el.solutionText) el.solutionText.innerHTML = renderSolutionHtml(solution);
    state.latestSolutionText = [
      "Detected Problem:",
      solution.problem,
      "",
      ...solution.steps.map((step, i) => `Step ${i + 1}: ${step}`),
    ].join("\n");
  };

  const getDeepSeekApiKey = () => {
    let apiKey = localStorage.getItem(DEEPSEEK_API_KEY_STORAGE_KEY) || "";
    if (apiKey) return apiKey;
    apiKey = window.prompt("Enter your DeepSeek API key to enable solving:") || "";
    apiKey = apiKey.trim();
    if (!apiKey) return "";
    localStorage.setItem(DEEPSEEK_API_KEY_STORAGE_KEY, apiKey);
    return apiKey;
  };

  const parseSolutionPayload = (content) => {
    const raw = String(content || "").trim();
    const normalized = raw.startsWith("```")
      ? raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim()
      : raw;
    const parsed = JSON.parse(normalized);
    if (!parsed.problem || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error("Invalid model response");
    }
    return {
      problem: String(parsed.problem),
      steps: parsed.steps.map((step) => String(step)),
    };
  };

  const generateSolutionWithDeepSeek = async (imageDataUrl, apiKey) => {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a helpful math tutor. Non-thinking mode. Return only valid JSON.",
          },
          {
            role: "user",
            content:
              "Solve the homework from this uploaded image data URL. Respond with strict JSON only: {\"problem\": string, \"steps\": string[]}. Keep steps concise.\n\nImage data URL:\n" +
              imageDataUrl,
          },
        ],
        max_tokens: DEEPSEEK_MAX_OUTPUT_TOKENS,
        response_format: { type: "json_object" },
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek request failed (${response.status})`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    return parseSolutionPayload(content);
  };

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) {
      showToast("Please upload an image file.", true);
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = String(event.target?.result || "");
      state.originalImageDataUrl = dataUrl;
      setPreview(dataUrl, file.name);
      showToast("Image uploaded.");
    };
    reader.readAsDataURL(file);
  };

  el.dropzone.addEventListener("click", () => {
    el.fileInput.value = "";
  });

  el.fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    await handleFile(file);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    el.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.dropzone.classList.add("dropzone-active");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    el.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      el.dropzone.classList.remove("dropzone-active");
    });
  });

  el.dropzone.addEventListener("drop", async (event) => {
    const file = event.dataTransfer?.files?.[0];
    await handleFile(file);
  });

  if (el.cropBtn) {
    el.cropBtn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await cropCenterSquare();
    });
  }

  if (el.resetBtn) {
    el.resetBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!state.originalImageDataUrl) {
        showToast("No image to reset.", true);
        return;
      }
      setPreview(state.originalImageDataUrl, state.currentFileName);
      showToast("Image reset.");
    });
  }

  el.solveBtn.addEventListener("click", async () => {
    if (!state.currentImageDataUrl) {
      showToast("Upload a homework photo first.", true);
      return;
    }
    if (state.credits <= 0) {
      showToast("No credits left. Upgrade your plan.", true);
      return;
    }

    const apiKey = getDeepSeekApiKey();
    if (!apiKey) {
      showToast("DeepSeek API key required to solve.", true);
      return;
    }

    state.credits -= 1;
    updateCredits();
    const solveDurationMs = PLAN_CONFIG[state.plan].solveDurationMs;
    setSolutionLoading(solveDurationMs);

    if (solveTimeoutId) clearTimeout(solveTimeoutId);
    solveTimeoutId = setTimeout(async () => {
      try {
        const solution = await generateSolutionWithDeepSeek(state.currentImageDataUrl, apiKey);
        setSolutionResult(solution);
        showToast("Solution generated.");
      } catch (error) {
        state.credits += 1;
        updateCredits();
        clearSolveStatusTimer();
        if (el.solutionSkeleton) el.solutionSkeleton.classList.add("hidden");
        if (el.solutionEmpty) el.solutionEmpty.classList.remove("hidden");
        showToast(error instanceof Error ? error.message : "Solve failed.", true);
      }
    }, solveDurationMs);
  });

  if (el.exportNotesBtn) {
    el.exportNotesBtn.addEventListener("click", () => {
      if (!state.latestSolutionText) {
        showToast("No solution to export yet.", true);
        return;
      }
      const blob = new Blob([state.latestSolutionText], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "openstep-solution-notes.txt";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Notes exported.");
    });
  }

  if (el.exportPdfBtn) {
    el.exportPdfBtn.addEventListener("click", () => {
      if (!state.latestSolutionText) {
        showToast("No solution to export yet.", true);
        return;
      }
      window.print();
    });
  }

  const openUpgradeModal = () => {
    if (!el.upgradeModal) return;
    el.upgradeModal.classList.remove("hidden");
    el.upgradeModal.classList.add("flex");
  };
  const closeUpgradeModal = () => {
    if (!el.upgradeModal) return;
    el.upgradeModal.classList.remove("flex");
    el.upgradeModal.classList.add("hidden");
  };
  const activatePlan = (plan) => {
    if (!Object.prototype.hasOwnProperty.call(PLAN_CONFIG, plan)) return;
    state.plan = plan;
    state.credits = Math.max(state.credits, PLAN_CONFIG[plan].monthlyCredits);
    updateCredits();
  };
  const ensureStripeLinkConfigured = (plan) => {
    const checkoutUrl = STRIPE_CHECKOUT_URLS[plan] || "";
    return checkoutUrl.startsWith("https://") && !checkoutUrl.includes("REPLACE_WITH_");
  };

  if (el.upgradeBtn) el.upgradeBtn.addEventListener("click", openUpgradeModal);
  if (el.closeUpgradeModalBtn) el.closeUpgradeModalBtn.addEventListener("click", closeUpgradeModal);
  if (el.upgradeModal) {
    el.upgradeModal.addEventListener("click", (event) => {
      if (event.target === el.upgradeModal) closeUpgradeModal();
    });
  }

  if (el.stripeCheckoutPlusBtn) {
    el.stripeCheckoutPlusBtn.addEventListener("click", () => {
      if (!ensureStripeLinkConfigured("plus")) {
        showToast("Set your Plus Stripe link in script.js first.", true);
        return;
      }
      window.location.href = STRIPE_CHECKOUT_URLS.plus;
    });
  }

  if (el.stripeCheckoutProBtn) {
    el.stripeCheckoutProBtn.addEventListener("click", () => {
      if (!ensureStripeLinkConfigured("pro")) {
        showToast("Set your Pro Stripe link in script.js first.", true);
        return;
      }
      window.location.href = STRIPE_CHECKOUT_URLS.pro;
    });
  }

  const params = new URLSearchParams(window.location.search);
  const upgradedPlan = params.get("upgraded");
  if (upgradedPlan === "plus" || upgradedPlan === "pro" || upgradedPlan === "1") {
    const resolvedPlan = upgradedPlan === "1" ? "plus" : upgradedPlan;
    activatePlan(resolvedPlan);
    showToast(`${PLAN_CONFIG[resolvedPlan].name} plan activated.`);
    params.delete("upgraded");
    const newQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${newQuery ? `?${newQuery}` : ""}`);
  }
  if (params.get("canceled") === "1") {
    showToast("Checkout canceled.");
    params.delete("canceled");
    const newQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${newQuery ? `?${newQuery}` : ""}`);
  }

  updateCredits();
});
