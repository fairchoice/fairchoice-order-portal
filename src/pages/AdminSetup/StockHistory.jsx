import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";

export default function StockHistory() {
  const [movements, setMovements] = useState([]);

  useEffect(() => {
    fetchMovements();
  }, []);

  const fetchMovements = async () => {
    const { data, error } = await supabase
      .from("stock_movements")
      .select(`
        *,
        products (
          product_name
        )
      `)
      .order("created_at", { ascending: false });

    if (!error) {
      setMovements(data || []);
    }
  };

  return (
    <div className="p-5">
      <h2 className="text-2xl font-bold mb-4">
        Stock History
      </h2>

      <div className="bg-white rounded-2xl shadow overflow-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b bg-slate-50">
              <th className="p-3 text-left">Date</th>
              <th className="p-3 text-left">Product</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Qty</th>
              <th className="p-3 text-left">Before</th>
              <th className="p-3 text-left">After</th>
              <th className="p-3 text-left">Note</th>
            </tr>
          </thead>

          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-b">
                <td className="p-3">
                  {new Date(m.created_at).toLocaleString()}
                </td>

                <td className="p-3">
                  {m.products?.product_name}
                </td>

                <td className="p-3">
                  {m.movement_type}
                </td>

                <td
                  className={`p-3 font-bold ${
                    Number(m.qty) > 0
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {m.qty}
                </td>

                <td className="p-3">
                  {m.stock_before}
                </td>

                <td className="p-3">
                  {m.stock_after}
                </td>

                <td className="p-3">
                  {m.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}