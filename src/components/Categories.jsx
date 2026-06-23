import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";
import ProductSetupOptions from "../components/ProductSetupOptions";

export default function Categories() {
  const [productOptions, setProductOptions] = useState([]);

  useEffect(() => {
    fetchProductOptions();
  }, []);

  const fetchProductOptions = async () => {
    const { data, error } = await supabase
      .from("product_options")
      .select("*")
      .eq("active", true)
      .order("option_type")
      .order("option_name");

    if (error) {
      alert(error.message);
      return;
    }

    setProductOptions(data || []);
  };

  const groupedOptions = {
    mainCategories: productOptions.filter(
      (option) => option.option_type === "main_category"
    ),
    subCategories: productOptions.filter(
      (option) => option.option_type === "sub_category"
    ),
    brands: productOptions.filter((option) => option.option_type === "brand"),
    series: productOptions.filter((option) => option.option_type === "series"),
  };

  const productSetupTypeMap = {
    mainCategories: "main_category",
    subCategories: "sub_category",
    brands: "brand",
    series: "series",
  };

  const addCategoryOption = async (typeKey, value) => {
    const optionType = productSetupTypeMap[typeKey];
    const optionName = value.trim();

    if (!optionType || !optionName) {
      alert("Enter option name.");
      return;
    }

    const { error } = await supabase.from("product_options").insert({
      option_type: optionType,
      option_name: optionName,
      active: true,
    });

    if (error) {
      alert(error.message);
      return;
    }

    fetchProductOptions();
  };

  const deleteCategoryOption = async (_typeKey, option) => {
    if (!option?.id) return;

    const { error } = await supabase
      .from("product_options")
      .update({ active: false })
      .eq("id", option.id);

    if (error) {
      alert(error.message);
      return;
    }

    fetchProductOptions();
  };

  return (
    <div className="p-4 max-w-6xl mx-auto bg-slate-50 min-h-screen">
      <ProductSetupOptions
        title="Categories"
        description="Manage Main Categories, Sub Categories, Brands, and Series."
        optionsByType={groupedOptions}
        onAddOption={addCategoryOption}
        onDeleteOption={deleteCategoryOption}
      />
    </div>
  );
}
