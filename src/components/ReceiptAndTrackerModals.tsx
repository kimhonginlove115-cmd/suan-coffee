import { AnimatePresence, motion } from 'motion/react';
import { Check, MapPin, Send, X } from 'lucide-react';
import type { Order } from '../types';

interface ReceiptModalProps {
  order: Order | null;
  tgUrl: string;
  onClose: () => void;
  onOpenLiveTrack: (orderId: string) => void;
}

export function ReceiptModal({ order, tgUrl, onClose, onOpenLiveTrack }: ReceiptModalProps) {
  return (
    <AnimatePresence>
      {order && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm z-[75] flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            className="bg-white w-full max-w-sm rounded-3xl p-5 space-y-3 shadow-2xl text-center"
          >
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 340, damping: 18 }}
              className="w-14 h-14 bg-[#E8F2EF] text-[#0D4A3E] rounded-full flex items-center justify-center mx-auto"
            >
              <Check className="w-7 h-7 stroke-[2.8]" />
            </motion.div>
            <h3 className="font-bold text-lg text-[#0D4A3E]">កម្ម៉ង់បានជោគជ័យ!</h3>
            <p className="text-xs text-slate-500 font-mono-num">
              {order.id} · ម៉ោង {order.timestamp}
            </p>

            <div className="bg-slate-50 p-3.5 rounded-2xl text-left text-xs space-y-1.5 max-h-48 overflow-y-auto">
              {order.items.map((i, idx) => (
                <div key={idx} className="flex justify-between gap-2">
                  <span>
                    {i.qty}x {i.name}{' '}
                    <span className="text-slate-400">({i.options})</span>
                  </span>
                  <span className="font-mono-num shrink-0">${(i.unitPrice * i.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <div className="text-xs text-slate-600 space-y-1 px-1">
              {order.promoDisc > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>បញ្ចុះតម្លៃ Promo៖</span>
                  <span className="font-mono-num">-${Number(order.promoDisc).toFixed(2)}</span>
                </div>
              )}
              {order.type === 'delivery' && (
                <div className="flex justify-between">
                  <span>ថ្លៃដឹកជញ្ជូន៖</span>
                  <span className="font-mono-num">${Number(order.fee || 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm text-slate-900 pt-1 border-t border-slate-100">
                <span>សរុប ({order.payment})៖</span>
                <span className="font-mono-num text-[#0D4A3E]">
                  ${Number(order.grandTotal || 0).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              {order.type === 'delivery' && (
                <button
                  type="button"
                  onClick={() => onOpenLiveTrack(order.id)}
                  className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5"
                >
                  <MapPin className="w-4 h-4" />
                  <span>មើលទីតាំងអ្នកដឹក Live Map</span>
                </button>
              )}
              {tgUrl && (
                <a
                  href={tgUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>ផ្ញើវិក្កយបត្រទៅ Telegram ហាង</span>
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-2.5 rounded-xl text-xs"
              >
                បិទ
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface OrderTrackerModalProps {
  isOpen: boolean;
  orders: Order[];
  onClose: () => void;
  onOpenLiveTrack: (orderId: string) => void;
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  Pending: { text: 'រង់ចាំហាងទទួល', cls: 'text-amber-700' },
  Brewing: { text: 'កំពុងរៀបចំ', cls: 'text-sky-700' },
  Ready: { text: 'កំពុងដឹកជញ្ជូន', cls: 'text-[#0D4A3E]' },
  Completed: { text: 'បានបញ្ចប់', cls: 'text-slate-500' },
};

export function OrderTrackerModal({ isOpen, orders, onClose, onOpenLiveTrack }: OrderTrackerModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/55 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className="bg-white w-full max-w-md rounded-3xl p-5 overflow-y-auto shadow-2xl"
            style={{ maxHeight: '85vh' }}
          >
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-base text-[#0D4A3E]">តាមដានការកម្ម៉ង់ & Live Map</h3>
              <button
                type="button"
                onClick={onClose}
                aria-label="បិទ"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-slate-100 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!orders.length ? (
              <p className="text-center text-slate-400 py-10 text-sm">មិនទាន់មានការកម្ម៉ង់ទេ</p>
            ) : (
              <div className="space-y-3">
                {orders.slice(0, 10).map((o) => {
                  const st = STATUS_LABEL[o.status] || STATUS_LABEL.Pending;
                  return (
                    <div key={o.id} className="border border-slate-200 rounded-2xl p-3.5 text-xs space-y-2">
                      <div className="flex justify-between items-center font-bold">
                        <span className="font-mono-num text-slate-900">
                          {o.id} · {o.timestamp}
                        </span>
                        <span className={st.cls}>{st.text}</span>
                      </div>
                      <div className="text-slate-600 space-y-0.5">
                        {o.items.map((i, idx) => (
                          <div key={idx}>
                            {i.qty}x {i.name} ({i.options})
                          </div>
                        ))}
                      </div>
                      <div className="flex justify-between font-bold text-[#0D4A3E] pt-1.5 border-t border-slate-100">
                        <span>{o.payment}</span>
                        <span className="font-mono-num">${Number(o.grandTotal || 0).toFixed(2)}</span>
                      </div>
                      {o.type === 'delivery' && o.status !== 'Completed' && (
                        <button
                          type="button"
                          onClick={() => onOpenLiveTrack(o.id)}
                          className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-2 rounded-xl text-xs"
                        >
                          🗺️ មើលទីតាំងអ្នកដឹក Live Map
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
