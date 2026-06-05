async function loadToast() {
  const module = await import('react-toastify');
  return module.toast;
}

function showToast(type, message, options) {
  loadToast()
    .then(toast => {
      const fn = toast[type] || toast;
      fn(message, options);
    })
    .catch(error => {
      console.warn(`Toast load failed: ${error.message}`);
    });
}

export const notify = {
  info: (message, options) => showToast('info', message, options),
  success: (message, options) => showToast('success', message, options),
  warn: (message, options) => showToast('warn', message, options),
  error: (message, options) => showToast('error', message, options)
};
