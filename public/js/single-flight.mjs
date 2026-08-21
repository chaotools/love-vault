// 防止同一个异步操作在完成前被重复触发（例如连点保存按钮）。
export function singleFlight(task, onPendingChange = () => {}) {
  let pending = false;
  return async (...args) => {
    if (pending) return undefined;
    pending = true;
    onPendingChange(true);
    try {
      return await task(...args);
    } finally {
      pending = false;
      onPendingChange(false);
    }
  };
}
