import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Minus, Plus, X } from 'lucide-react';
import type { MenuItem, Topping } from '../types';
import { CAFE_ASSETS, getDiscountedPrice, handleImgFallback, resolveAssetUrl } from '../utils/cafeUtils';

interface ItemCustomizerModalProps {
  item: MenuItem | null;
  toppings: Topping[];
  onClose: () => void;
  onAddToCart: (payload: {
    name: string;
    img: string;
    qty: number;
    unitPrice: number;
    options: string;
  }) => void;
}

export function ItemCustomizerModal({ item, toppings, onClose, onAddToCart }: ItemCustomizerModalProps) {
  const [qty, setQty] = useState(1);
  const [temp, setTemp] = useState<'ត្រជាក់ (Iced)' | 'ក្តៅ (Hot)'>('ត្រជាក់ (Iced)');
  const [size, setSize] = useState<'M|0' | 'L|0.5'>('M|0');
  const [sugar, setSugar] = useState('75%');
  const [ice, setIce] = useState('ទឹកកកធម្មតា');
  const [foodSpice, setFoodSpice] = useState('ធម្មតា');
  const [selectedToppings, setSelectedToppings] = useState<string[]>([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!item) return;
    setQty(1);
    setTemp('ត្រជាក់ (Iced)');
    setSize('M|0');
    setSugar('75%');
    setIce('ទឹកកកធម្មតា');
    setFoodSpice('ធម្មតា');
    setSelectedToppings([]);
    setNote('');
  }, [item]);

  const isDrink = item ? item.type !== 'food' : true;
  const basePrice = item ? getDiscountedPrice(item) : 0;
  const sizeExtra = isDrink ? parseFloat(size.split('|')[1]) || 0 : 0;
  const availableToppings = toppings.filter((t) => t.available);
  const toppingsExtra = isDrink
    ? availableToppings
        .filter((t) => selectedToppings.includes(String(t.id)))
        .reduce((s, t) => s + Number(t.price || 0), 0)
    : 0;
  const unitPrice = basePrice + sizeExtra + toppingsExtra;

  const toggleTopping = (id: string) => {
    setSelectedToppings((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleConfirm = () => {
    if (!item) return;
    let options = '';
    if (isDrink) {
      const szLabel = size.split('|')[0];
      const topNames = availableToppings
        .filter((t) => selectedToppings.includes(String(t.id)))
        .map((t) => t.name);
      options = `${temp}, Size ${szLabel}, ផ្អែម ${sugar}${
        temp.includes('ក្តៅ') ? '' : `, ${ice}`
      }${topNames.length ? `, +${topNames.join(', ')}` : ''}`;
    } else {
      options = foodSpice;
    }
    if (note.trim()) options += ` (${note.trim()})`;
    onAddToCart({
      name: item.name,
      img: resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte),
      qty: Math.min(99, Math.max(1, qty)),
      unitPrice,
      options,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {item && (
        <motion.div
          key="customizer-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/55 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            key={item.id}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5 overflow-y-auto shadow-2xl"
            style={{ maxHeight: '88vh' }}
          >
            <div className="flex justify-between items-start gap-3 mb-4">
              <div className="flex gap-3 items-center min-w-0">
                <img
                  src={resolveAssetUrl(item.img, CAFE_ASSETS.icedLatte)}
                  alt={item.name}
                  referrerPolicy="no-referrer"
                  onError={(e) => handleImgFallback(e, CAFE_ASSETS.icedLatte)}
                  className="w-16 h-16 rounded-2xl object-cover bg-slate-100 shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="font-bold text-base text-slate-900 truncate">{item.name}</h3>
                  <p className="text-xs text-slate-500 line-clamp-2">{item.desc}</p>
                  <p className="text-sm font-bold font-mono-num text-[#0D4A3E] mt-0.5">
                    ${basePrice.toFixed(2)}
                    {item.discount > 0 ? ` (-${item.discount}%)` : ''}
                  </p>
                </div>
              </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="បិទ"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-full shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {isDrink ? (
            <div className="space-y-3 border-t border-slate-100 pt-3.5">
              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                {(['ត្រជាក់ (Iced)', 'ក្តៅ (Hot)'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTemp(t)}
                    className={`border rounded-xl py-2.5 px-3 transition-colors ${
                      temp === t
                        ? 'bg-[#0D4A3E] text-white border-[#0D4A3E]'
                        : 'border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    {t.includes('ត្រជាក់') ? '🧊 ត្រជាក់ (Iced)' : '☕ ក្តៅ (Hot)'}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setSize('M|0')}
                  className={`border rounded-xl py-2.5 px-3 text-left transition-colors ${
                    size === 'M|0'
                      ? 'bg-[#E8F2EF] border-[#0D4A3E] text-[#0D4A3E]'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  Medium (M)
                </button>
                <button
                  type="button"
                  onClick={() => setSize('L|0.5')}
                  className={`border rounded-xl py-2.5 px-3 text-left transition-colors ${
                    size === 'L|0.5'
                      ? 'bg-[#E8F2EF] border-[#0D4A3E] text-[#0D4A3E]'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  Large (L) +$0.50
                </button>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-slate-500 mb-1.5">កម្រិតផ្អែម</p>
                <div className="grid grid-cols-4 gap-1.5 text-xs font-bold">
                  {['0%', '50%', '75%', '100%'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSugar(s)}
                      className={`border rounded-xl py-2 transition-colors ${
                        sugar === s
                          ? 'bg-[#0D4A3E] text-white border-[#0D4A3E]'
                          : 'border-slate-200 text-slate-700'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {temp.includes('ត្រជាក់') && (
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 mb-1.5">កម្រិតទឹកកក</p>
                  <div className="grid grid-cols-3 gap-1.5 text-xs font-bold">
                    {['ទឹកកកធម្មតា', 'ទឹកកកតិច', 'អត់ទឹកកក'].map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        onClick={() => setIce(ic)}
                        className={`border rounded-xl py-2 transition-colors ${
                          ice === ic
                            ? 'bg-[#0D4A3E] text-white border-[#0D4A3E]'
                            : 'border-slate-200 text-slate-700'
                        }`}
                      >
                        {ic === 'ទឹកកកធម្មតា' ? 'ធម្មតា' : ic}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {availableToppings.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-slate-500">បន្ថែម Topping</p>
                  {availableToppings.map((t) => {
                    const checked = selectedToppings.includes(String(t.id));
                    return (
                      <label
                        key={t.id}
                        className={`border rounded-xl px-3 py-2 flex items-center justify-between text-xs cursor-pointer transition-colors ${
                          checked ? 'border-[#0D4A3E] bg-[#E8F2EF]' : 'border-slate-200'
                        }`}
                      >
                        <span className="font-medium text-slate-800">
                          {t.name} (+${Number(t.price).toFixed(2)})
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTopping(String(t.id))}
                          className="accent-[#0D4A3E] w-4 h-4"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 mt-3 border-t border-slate-100 pt-3.5 text-xs font-bold">
              {['ធម្មតា', 'អត់ហឹរ', 'ហឹរ/ក្តៅ'].map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => setFoodSpice(sp)}
                  className={`border rounded-xl py-2.5 transition-colors ${
                    foodSpice === sp
                      ? 'bg-[#0D4A3E] text-white border-[#0D4A3E]'
                      : 'border-slate-200 text-slate-700'
                  }`}
                >
                  {sp}
                </button>
              ))}
            </div>
          )}

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ចំណាំបន្ថែម..."
            className="w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs mt-3.5 focus:outline-none focus:border-[#0D4A3E]"
          />

          <div className="mt-4 flex items-center gap-3">
            <div className="flex items-center border border-slate-200 rounded-xl">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                aria-label="បន្ថយចំនួន"
                className="min-h-[42px] px-3 text-slate-700 hover:bg-slate-50 rounded-l-xl"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="px-3 text-sm font-bold font-mono-num">{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                aria-label="បន្ថែមចំនួន"
                className="min-h-[42px] px-3 text-slate-700 hover:bg-slate-50 rounded-r-xl"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleConfirm}
              className="flex-1 bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-3 rounded-xl text-sm font-mono-num transition-colors active:scale-[0.98]"
            >
              ដាក់កន្ត្រក · ${(unitPrice * qty).toFixed(2)}
            </button>
          </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
