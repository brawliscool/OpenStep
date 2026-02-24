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

  el.solveBtn.addEventListener("click", () => {
    if (!state.currentImageDataUrl) {
      showToast("Upload a homework photo first.", true);
      return;
    }
    if (state.credits <= 0) {
      showToast("No credits left. Upgrade your plan.", true);
      return;
    }

    state.credits -= 1;
    updateCredits();
    const solveDurationMs = PLAN_CONFIG[state.plan].solveDurationMs;
    setSolutionLoading(solveDurationMs);

    if (solveTimeoutId) clearTimeout(solveTimeoutId);
    solveTimeoutId = setTimeout(() => {
      const solution = {
        problem: "Solve for x: 3x + 7 = 28",
        steps: ["Subtract 7 from both sides: 3x = 21", "Divide both sides by 3: x = 7"],
      };
      setSolutionResult(solution);
      showToast("Solution generated.");
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
