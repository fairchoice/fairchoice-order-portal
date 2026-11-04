const noticeStyles = {
  warning: { title: "Important Notice", icon: "!", banner: "border-amber-500 bg-amber-100 text-amber-950", iconBackground: "bg-amber-200", messageText: "text-amber-950" },
  info: { title: "Customer Information", icon: "i", banner: "border-blue-400 bg-blue-100 text-blue-950", iconBackground: "bg-blue-200", messageText: "text-blue-950" },
  success: { title: "Good News", icon: "✓", banner: "border-green-500 bg-green-100 text-green-950", iconBackground: "bg-green-200", messageText: "text-green-950" },
  danger: { title: "Customer Alert", icon: "!", banner: "border-red-500 bg-red-100 text-red-950", iconBackground: "bg-red-200", messageText: "text-red-950" },
  info_blue: { title: "Customer Information", icon: "i", banner: "border-blue-400 bg-blue-100 text-blue-950", iconBackground: "bg-blue-200", messageText: "text-blue-950" },
  navy: { title: "Customer Information", icon: "i", banner: "border-slate-700 bg-slate-100 text-slate-950", iconBackground: "bg-slate-300", messageText: "text-slate-950" },
  success_green: { title: "Customer Information", icon: "✓", banner: "border-green-500 bg-green-100 text-green-950", iconBackground: "bg-green-200", messageText: "text-green-950" },
  teal: { title: "Customer Information", icon: "i", banner: "border-teal-500 bg-teal-100 text-teal-950", iconBackground: "bg-teal-200", messageText: "text-teal-950" },
  warning_amber: { title: "Important Notice", icon: "!", banner: "border-amber-500 bg-amber-100 text-amber-950", iconBackground: "bg-amber-200", messageText: "text-amber-950" },
  orange: { title: "Important Notice", icon: "!", banner: "border-orange-500 bg-orange-100 text-orange-950", iconBackground: "bg-orange-200", messageText: "text-orange-950" },
  danger_red: { title: "Customer Alert", icon: "!", banner: "border-red-500 bg-red-100 text-red-950", iconBackground: "bg-red-200", messageText: "text-red-950" },
  purple: { title: "Customer Information", icon: "i", banner: "border-purple-500 bg-purple-100 text-purple-950", iconBackground: "bg-purple-200", messageText: "text-purple-950" },
  pink: { title: "Customer Information", icon: "i", banner: "border-pink-500 bg-pink-100 text-pink-950", iconBackground: "bg-pink-200", messageText: "text-pink-950" },
  plain: { title: "Customer Information", icon: "i", banner: "border-slate-400 bg-white text-slate-950", iconBackground: "bg-slate-200", messageText: "text-slate-950" },
};

export default function HomepageTargetMessages({ messages = [] }) {
  if (messages.length === 0) return null;

  const orderedMessages = [...messages].sort(
    (left, right) =>
      Number(left.sortOrder || 3) - Number(right.sortOrder || 3) ||
      String(left.id || "").localeCompare(String(right.id || ""))
  );
  const visibleMessages = orderedMessages.slice(0, 2);
  const remainingCount = Math.max(0, orderedMessages.length - visibleMessages.length);

  return (
    <section className="mb-3 w-full space-y-2" aria-label="Customer product notices" aria-live="polite">
      {visibleMessages.map((message) => {
        const style = noticeStyles[message.messageStyle] || noticeStyles.warning;
        const priority = Number(message.sortOrder || 3);
        const priorityLabel = priority <= 1 ? "Important" : priority === 2 ? "Promotion" : style.title;
        return (
          <div key={message.id} role="alert" className={`w-full rounded-xl border-2 px-3 py-2 shadow-sm sm:px-4 ${style.banner}`}>
            <div className="flex items-center gap-3">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base font-black ${style.iconBackground}`} aria-hidden="true">{style.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-black uppercase tracking-wide opacity-80">{priorityLabel}</div>
                <p className={`text-sm font-semibold leading-5 ${style.messageText}`}>{message.message}</p>
              </div>
            </div>
          </div>
        );
      })}
      {remainingCount > 0 && (
        <div className="px-1 text-xs font-bold text-slate-500">+{remainingCount} more relevant notice{remainingCount === 1 ? "" : "s"}</div>
      )}
    </section>
  );
}
