export default function PaymentChoiceSelector({ choice, onChoiceChange }) {
  return (
    <fieldset className="mt-4 border-t pt-4">
      <legend className="text-base font-extrabold text-slate-900">How would you like to continue?</legend>
      <div className="mt-3 grid grid-cols-1 gap-2">
        <label className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-2xl border p-3 ${choice === "no_payment" ? "border-orange-600 bg-orange-50 ring-2 ring-orange-200" : "border-slate-300 bg-white"}`}>
          <input
            type="radio"
            name="order-payment-choice"
            value="no_payment"
            checked={choice === "no_payment"}
            onChange={() => onChoiceChange("no_payment")}
            className="mt-1 h-5 w-5 accent-orange-600"
          />
          <span>
            <span className="block font-extrabold">No Payment Now</span>
            <span className="block text-sm text-slate-600">Continue without taking payment now.</span>
          </span>
        </label>

        <label className="flex min-h-16 cursor-not-allowed items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 opacity-70">
          <input
            type="radio"
            name="order-payment-choice"
            value="card_now"
            checked={choice === "card_now"}
            disabled
            className="mt-1 h-5 w-5"
          />
          <span>
            <span className="block font-extrabold">Pay by Card Now</span>
            <span className="block text-sm text-slate-600">If you wish to pay now by card, select here.</span>
            <span className="mt-1 block text-xs font-bold text-amber-700">Card payment is not available in this checkout yet.</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
