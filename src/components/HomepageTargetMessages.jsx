const noticeStyles = {
  warning: {
    title: "Important Price Notice",
    icon: "⚠",
    banner: "border-amber-400 bg-amber-50 text-amber-950",
    iconBackground: "bg-amber-200",
    messageText: "text-amber-900",
  },
  info: {
    title: "Customer Information",
    icon: "ℹ",
    banner: "border-blue-400 bg-blue-50 text-blue-950",
    iconBackground: "bg-blue-200",
    messageText: "text-blue-900",
  },
  success: {
    title: "Good News",
    icon: "✓",
    banner: "border-green-400 bg-green-50 text-green-950",
    iconBackground: "bg-green-200",
    messageText: "text-green-900",
  },
  danger: {
    title: "Important Customer Alert",
    icon: "!",
    banner: "border-red-400 bg-red-50 text-red-950",
    iconBackground: "bg-red-200",
    messageText: "text-red-900",
  },
};

export default function HomepageTargetMessages({ messages = [] }) {
  if (messages.length === 0) return null;

  const orderedMessages = [...messages].sort(
    (left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
      String(left.id || "").localeCompare(String(right.id || ""))
  );

  return (
    <section
      className="mb-5 w-full space-y-3"
      aria-label="Customer product notices"
      aria-live="polite"
    >
      {orderedMessages.map((message) => {
        const style =
          noticeStyles[message.messageStyle] || noticeStyles.warning;
        return (
          <div
            key={message.id}
            role="alert"
            className={`w-full rounded-2xl border-2 p-4 shadow-md sm:p-5 ${style.banner}`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl font-black ${style.iconBackground}`}
                aria-hidden="true"
              >
                {style.icon}
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-extrabold sm:text-lg">
                  {style.title}
                </h3>
                <p
                  className={`mt-1 text-sm font-semibold leading-6 sm:text-base ${style.messageText}`}
                >
                  {message.message}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
