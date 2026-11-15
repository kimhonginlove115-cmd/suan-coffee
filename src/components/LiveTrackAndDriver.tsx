import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import L from 'leaflet';
import {
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Globe,
  LocateFixed,
  MapPin,
  Navigation,
  Phone,
  QrCode,
  Send,
  Truck,
  UserCheck,
  X,
} from 'lucide-react';
import type { AppLang, Coords, DriverInfo, Order, OrderStatus, ShopSettings } from '../types';
import { getDistanceKm, safeGet, safeSet } from '../utils/cafeUtils';
import { getOrderStatusText } from '../utils/i18n';
import { makeResilientTileLayer } from './LocationPickerModal';

interface LiveTrackModalProps {
  lang?: AppLang;
  order: Order | null;
  shopSettings: ShopSettings;
  onClose: () => void;
  onUpdateCustomerCoords: (orderId: string, coords: Coords) => void;
  onOpenDriverConsole: (orderId: string) => void;
  onToast: (msg: string) => void;
}

const TRACK_STEPS: Array<{ status: OrderStatus; km: string; en: string }> = [
  { status: 'Pending', km: 'ទទួលកម្ម៉ង់', en: 'Ordered' },
  { status: 'Brewing', km: 'កំពុងឆុង', en: 'Preparing' },
  { status: 'Ready', km: 'កំពុងដឹក', en: 'On the Way' },
  { status: 'Completed', km: 'ដល់ដៃ', en: 'Delivered' },
];

export function LiveTrackModal({
  lang = 'km',
  order,
  shopSettings,
  onClose,
  onUpdateCustomerCoords,
  onOpenDriverConsole,
  onToast,
}: LiveTrackModalProps) {
  const isEn = lang === 'en';
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const shopMarkerRef = useRef<L.Marker | null>(null);
  const custMarkerRef = useRef<L.Marker | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');

  const cLat = order?.customer?.coords?.lat ?? shopSettings.lat;
  const cLng = order?.customer?.coords?.lng ?? shopSettings.lng;
  const dLat = order?.driverCoords?.lat ?? shopSettings.lat;
  const dLng = order?.driverCoords?.lng ?? shopSettings.lng;

  const dist = order ? getDistanceKm(dLat, dLng, cLat, cLng) : 0;
  const mins = Math.max(1, Math.round(dist * 3));
  const currentStepIdx = order
    ? Math.max(0, TRACK_STEPS.findIndex((s) => s.status === order.status))
    : 0;
  const driverArrived = Boolean(order?.driverInfo?.arrivedAt) || dist < 0.05;

  const fitAllMarkers = () => {
    if (!mapRef.current) return;
    try {
      mapRef.current.fitBounds(
        [
          [shopSettings.lat, shopSettings.lng],
          [dLat, dLng],
          [cLat, cLng],
        ],
        { padding: [45, 45], maxZoom: 16 }
      );
    } catch {
      // ignore bounds error
    }
  };

  useEffect(() => {
    if (!order) {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
        shopMarkerRef.current = null;
        custMarkerRef.current = null;
        driverMarkerRef.current = null;
        routeLineRef.current = null;
      }
      return;
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const t = setTimeout(() => {
      if (!mapElRef.current || mapRef.current) return;
      const m = L.map(mapElRef.current, { zoomControl: true }).setView([dLat, dLng], 15);
      tileLayerRef.current = makeResilientTileLayer(mapStyle).addTo(m);
      mapRef.current = m;
      resizeTimer = setTimeout(() => {
        try {
          if (mapRef.current === m) m.invalidateSize();
        } catch {
          // ignore
        }
      }, 150);
    }, 180);

    return () => {
      clearTimeout(t);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(order)]);

  const switchStyle = (mode: 'street' | 'satellite') => {
    setMapStyle(mode);
    if (!mapRef.current) return;
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = makeResilientTileLayer(mode).addTo(mapRef.current);
  };

  useEffect(() => {
    if (!order || !mapRef.current) return;
    const m = mapRef.current;

    const sIcon = L.divIcon({
      className: 'custom-gps-icon',
      html: `<div style="background:#D99B26;color:#000;padding:2px 7px;border-radius:10px;font-weight:bold;font-size:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap;">☕ ${isEn ? 'Shop' : 'ហាង'}</div>`,
      iconSize: [52, 22],
      iconAnchor: [26, 11],
    });
    const cIcon = L.divIcon({
      className: 'custom-gps-icon',
      html: '<div style="background:#0D4A3E;color:#fff;width:30px;height:30px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.4);">🏠</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    const dIcon = L.divIcon({
      className: 'custom-gps-icon',
      html: '<div class="driver-badge">🛵</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    if (!shopMarkerRef.current)
      shopMarkerRef.current = L.marker([shopSettings.lat, shopSettings.lng], { icon: sIcon }).addTo(m);
    else shopMarkerRef.current.setLatLng([shopSettings.lat, shopSettings.lng]);

    if (!custMarkerRef.current) custMarkerRef.current = L.marker([cLat, cLng], { icon: cIcon }).addTo(m);
    else custMarkerRef.current.setLatLng([cLat, cLng]);

    if (!driverMarkerRef.current) driverMarkerRef.current = L.marker([dLat, dLng], { icon: dIcon }).addTo(m);
    else driverMarkerRef.current.setLatLng([dLat, dLng]);

    if (!routeLineRef.current) {
      routeLineRef.current = L.polyline(
        [
          [dLat, dLng],
          [cLat, cLng],
        ],
        { color: '#0D4A3E', weight: 4, dashArray: '8,8' }
      ).addTo(m);
      fitAllMarkers();
    } else {
      routeLineRef.current.setLatLngs([
        [dLat, dLng],
        [cLat, cLng],
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, cLat, cLng, dLat, dLng, shopSettings.lat, shopSettings.lng, isEn]);

  const handleShareLivePin = () => {
    if (!order || !navigator.geolocation) {
      onToast(isEn ? 'Please enable GPS on your device!' : 'សូមបើក GPS លើទូរស័ព្ទ!');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onUpdateCustomerCoords(order.id, { lat: p.coords.latitude, lng: p.coords.longitude });
        onToast(isEn ? 'Live location updated!' : 'បានអាប់ដេតទីតាំង Live ហើយ!');
      },
      () => onToast(isEn ? 'Please enable GPS on your device!' : 'សូមបើក GPS លើទូរស័ព្ទ!'),
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 5000 }
    );
  };

  return (
    <AnimatePresence>
      {order && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm z-[65] flex items-end sm:items-center justify-center"
        >
          <motion.div
            initial={{ y: 36, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 36, opacity: 0 }}
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92dvh]"
          >
            <div className="p-4 bg-[#0D4A3E] text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-base">
                  {isEn ? '🛵 Live Delivery Tracking' : '🛵 តាមដានអ្នកដឹក Live'}
                </h3>
                <p className="text-[11px] text-emerald-200 font-mono-num">
                  {order.id} · {getOrderStatusText(order.status, lang)}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={isEn ? 'Close' : 'បិទ'}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-white/15 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step progress bar */}
            <div className="px-4 py-2 bg-[#F6F8F7] border-b border-slate-200 grid grid-cols-4 gap-1 shrink-0">
              {TRACK_STEPS.map((st, idx) => {
                const done = idx <= currentStepIdx;
                return (
                  <div key={st.status} className="text-center space-y-1">
                    <div
                      className={`h-1.5 rounded-full transition-colors ${
                        done ? 'bg-[#0D4A3E]' : 'bg-slate-200'
                      }`}
                    />
                    <p
                      className={`text-[10px] font-bold truncate ${
                        done ? 'text-[#0D4A3E]' : 'text-slate-400'
                      }`}
                    >
                      {isEn ? st.en : st.km}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-center justify-between text-xs shrink-0">
              <span className="font-bold text-slate-800">
                {order.status === 'Completed'
                  ? isEn
                    ? '✅ Order delivered!'
                    : '✅ បានដឹកដល់ដៃរួចរាល់!'
                  : driverArrived
                    ? isEn
                      ? '🎉 Driver has arrived near you!'
                      : '🎉 អ្នកដឹកមកដល់ទីតាំងអ្នកហើយ!'
                    : isEn
                      ? `🛵 Est. ${mins} min away`
                      : `🛵 ប្រហែល ${mins} នាទីទៀតដល់`}
              </span>
              <span className="font-bold font-mono-num text-[#0D4A3E]">{dist.toFixed(2)} km</span>
            </div>

            {(order.driverInfo?.name || order.driverInfo?.phone) && (
              <div className="px-4 py-2 bg-white border-b border-slate-100 flex items-center justify-between gap-2 text-xs shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                    <UserCheck className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900 truncate">
                      {order.driverInfo.name || (isEn ? 'Delivery Driver' : 'អ្នកដឹកជញ្ជូន')}
                    </p>
                    {order.driverInfo.phone && (
                      <p className="text-[11px] font-mono-num text-slate-500">{order.driverInfo.phone}</p>
                    )}
                  </div>
                </div>
                {order.driverInfo.phone && (
                  <a
                    href={`tel:${order.driverInfo.phone}`}
                    className="bg-[#0D4A3E] text-white px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 shrink-0"
                  >
                    <Phone className="w-3 h-3" />
                    <span>{isEn ? 'Call Driver' : 'តេទៅអ្នកដឹក'}</span>
                  </a>
                )}
              </div>
            )}

            <div className="relative flex-1 bg-slate-100 min-h-[250px] h-[290px]">
              <div ref={mapElRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
              <div className="absolute top-3 right-3 z-[400] flex gap-1 bg-white/95 p-1 rounded-xl shadow border border-slate-200/80">
                <button
                  type="button"
                  onClick={() => switchStyle('street')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                    mapStyle === 'street' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                  }`}
                >
                  {isEn ? 'Map' : 'ផែនទី'}
                </button>
                <button
                  type="button"
                  onClick={() => switchStyle('satellite')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                    mapStyle === 'satellite' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                  }`}
                >
                  {isEn ? 'Satellite' : 'ផ្កាយរណប'}
                </button>
              </div>
              <button
                type="button"
                onClick={fitAllMarkers}
                className="absolute bottom-6 right-3 z-[400] bg-white text-[#0D4A3E] font-bold text-[11px] px-2.5 py-2 rounded-xl shadow-md flex items-center gap-1 border border-slate-200"
              >
                <LocateFixed className="w-3.5 h-3.5" />
                <span>{isEn ? 'Fit All' : 'មើលទាំងអស់'}</span>
              </button>
            </div>

            <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2 shrink-0 bg-white border-t border-slate-100">
              <button
                type="button"
                onClick={handleShareLivePin}
                className="w-full bg-[#E8F2EF] text-[#0D4A3E] font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5"
              >
                <MapPin className="w-4 h-4" />
                <span>
                  {isEn
                    ? 'Update My Live Pin for Driver'
                    : 'អាប់ដេតទីតាំង Live ខ្ញុំឱ្យអ្នកដឹកឃើញ'}
                </span>
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onOpenDriverConsole(order.id)}
                  className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-2.5 rounded-xl text-xs"
                >
                  {isEn ? '🛵 Driver Mode' : '🛵 ទម្រង់អ្នកដឹក'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs"
                >
                  {isEn ? 'Close' : 'បិទ'}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface DriverConsoleProps {
  lang?: AppLang;
  onChangeLang?: (lang: AppLang) => void;
  order: Order | null;
  orders: Order[];
  shopSettings: ShopSettings;
  onSelectOrder: (orderId: string) => void;
  onExit: () => void;
  onUpdateDriverCoords: (orderId: string, coords: Coords, status?: Order['status']) => void;
  onUpdateDriverInfo: (orderId: string, info: DriverInfo, nextStatus?: OrderStatus) => void;
  onCompleteDelivery: (orderId: string) => void;
  onToast: (msg: string) => void;
}

export function DriverConsole({
  lang = 'km',
  onChangeLang,
  order,
  orders,
  shopSettings,
  onSelectOrder,
  onExit,
  onUpdateDriverCoords,
  onUpdateDriverInfo,
  onCompleteDelivery,
  onToast,
}: DriverConsoleProps) {
  const isEn = lang === 'en';
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const shopMarkerRef = useRef<L.Marker | null>(null);
  const custMarkerRef = useRef<L.Marker | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastGpsSentAtRef = useRef(0);
  const lastGpsCoordsRef = useRef<Coords | null>(null);

  const [gpsActive, setGpsActive] = useState(false);
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [queueTab, setQueueTab] = useState<'active' | 'completed'>('active');
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [driverProfile, setDriverProfile] = useState<{ name: string; phone: string }>(() =>
    safeGet('cafe_driver_profile_v15', { name: '', phone: '' })
  );
  const [editingDriver, setEditingDriver] = useState(false);

  const deliveryOrders = useMemo(
    () =>
      orders
        .filter((o) => o.type === 'delivery')
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)),
    [orders]
  );
  const activeDeliveries = useMemo(
    () => deliveryOrders.filter((o) => o.status !== 'Completed'),
    [deliveryOrders]
  );
  const completedDeliveries = useMemo(
    () => deliveryOrders.filter((o) => o.status === 'Completed'),
    [deliveryOrders]
  );
  const codCollectedToday = useMemo(
    () =>
      completedDeliveries
        .filter((o) => o.payment === 'Cash')
        .reduce((s, o) => s + Number(o.grandTotal || 0), 0),
    [completedDeliveries]
  );

  // Auto-pick first active delivery when opening Driver Portal without specific order ID
  const currentOrder = useMemo(() => {
    if (order) return order;
    if (queueTab === 'active' && activeDeliveries.length > 0) return activeDeliveries[0];
    if (queueTab === 'completed' && completedDeliveries.length > 0) return completedDeliveries[0];
    return deliveryOrders[0] || null;
  }, [order, queueTab, activeDeliveries, completedDeliveries, deliveryOrders]);

  const cLat = currentOrder?.customer?.coords?.lat ?? shopSettings.lat;
  const cLng = currentOrder?.customer?.coords?.lng ?? shopSettings.lng;
  const dLat = currentOrder?.driverCoords?.lat ?? shopSettings.lat;
  const dLng = currentOrder?.driverCoords?.lng ?? shopSettings.lng;
  const distKm = currentOrder ? getDistanceKm(dLat, dLng, cLat, cLng) : 0;
  const etaMins = Math.max(1, Math.round(distKm * 3));

  const fitRoute = () => {
    if (!mapRef.current || !currentOrder) return;
    try {
      mapRef.current.fitBounds(
        [
          [shopSettings.lat, shopSettings.lng],
          [dLat, dLng],
          [cLat, cLng],
        ],
        { padding: [40, 40], maxZoom: 16 }
      );
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!currentOrder) {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
        shopMarkerRef.current = null;
        custMarkerRef.current = null;
        driverMarkerRef.current = null;
        lineRef.current = null;
      }
      return;
    }

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const t = setTimeout(() => {
      if (!mapElRef.current || mapRef.current) return;
      const m = L.map(mapElRef.current, { zoomControl: true }).setView([dLat, dLng], 15);
      tileLayerRef.current = makeResilientTileLayer(mapStyle).addTo(m);
      mapRef.current = m;
      resizeTimer = setTimeout(() => {
        try {
          if (mapRef.current === m) m.invalidateSize();
        } catch {
          // ignore
        }
      }, 150);
    }, 150);

    return () => {
      clearTimeout(t);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(currentOrder)]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
      }
    };
  }, []);

  const switchStyle = (mode: 'street' | 'satellite') => {
    setMapStyle(mode);
    if (!mapRef.current) return;
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = makeResilientTileLayer(mode).addTo(mapRef.current);
  };

  useEffect(() => {
    if (!mapRef.current || !currentOrder) return;
    const m = mapRef.current;
    const sIcon = L.divIcon({
      className: 'custom-gps-icon',
      html: `<div style="background:#D99B26;color:#000;padding:2px 7px;border-radius:10px;font-weight:bold;font-size:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap;">☕ ${isEn ? 'Shop' : 'ហាង'}</div>`,
      iconSize: [52, 22],
      iconAnchor: [26, 11],
    });
    const cIcon = L.divIcon({
      className: 'custom-gps-icon',
      html: '<div style="background:#0D4A3E;color:#fff;width:30px;height:30px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.4);">🏠</div>',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    const dIcon = L.divIcon({
      className: 'custom-gps-icon',
      html: '<div class="driver-badge">🛵</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });

    if (!shopMarkerRef.current)
      shopMarkerRef.current = L.marker([shopSettings.lat, shopSettings.lng], { icon: sIcon }).addTo(m);
    else shopMarkerRef.current.setLatLng([shopSettings.lat, shopSettings.lng]);

    if (!custMarkerRef.current) custMarkerRef.current = L.marker([cLat, cLng], { icon: cIcon }).addTo(m);
    else custMarkerRef.current.setLatLng([cLat, cLng]);

    if (!driverMarkerRef.current) driverMarkerRef.current = L.marker([dLat, dLng], { icon: dIcon }).addTo(m);
    else driverMarkerRef.current.setLatLng([dLat, dLng]);

    if (!lineRef.current) {
      lineRef.current = L.polyline(
        [
          [dLat, dLng],
          [cLat, cLng],
        ],
        { color: '#F59E0B', weight: 4, dashArray: '8,8' }
      ).addTo(m);
      fitRoute();
    } else {
      lineRef.current.setLatLngs([
        [dLat, dLng],
        [cLat, cLng],
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrder?.id, cLat, cLng, dLat, dLng, shopSettings.lat, shopSettings.lng, isEn]);

  const startLiveGPSForOrder = (targetOrderId: string) => {
    if (!navigator.geolocation) {
      onToast(isEn ? 'Device does not support GPS!' : 'ឧបករណ៍នេះមិនគាំទ្រ GPS ទេ!');
      return;
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    setGpsActive(true);
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const nextCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const prev = lastGpsCoordsRef.current;
        const movedKm = prev ? getDistanceKm(prev.lat, prev.lng, nextCoords.lat, nextCoords.lng) : 999;
        if (now - lastGpsSentAtRef.current < 3000 && movedKm < 0.008) {
          return;
        }
        lastGpsSentAtRef.current = now;
        lastGpsCoordsRef.current = nextCoords;
        onUpdateDriverCoords(targetOrderId, nextCoords, 'Ready');
      },
      () => {
        onToast(
          isEn
            ? 'Unable to read GPS signal! Please turn on Location Services.'
            : 'មិនអាចចាប់សញ្ញា GPS បានទេ! សូមបើក Location Services លើទូរស័ព្ទ'
        );
        setGpsActive(false);
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
  };

  const toggleLiveGPS = () => {
    if (!currentOrder) return;
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setGpsActive(false);
      return;
    }
    startLiveGPSForOrder(currentOrder.id);
  };

  const handleSingleGpsPing = () => {
    if (!currentOrder) return;
    if (!navigator.geolocation) {
      onUpdateDriverCoords(currentOrder.id, { lat: shopSettings.lat, lng: shopSettings.lng }, 'Ready');
      onToast(isEn ? 'Updated position to Shop Pin.' : 'បានផ្ញើទីតាំងចាប់ផ្តើមពីហាង!');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onUpdateDriverCoords(currentOrder.id, next, 'Ready');
        onToast(isEn ? '✓ Current GPS location sent!' : '✓ បានផ្ញើទីតាំង GPS បច្ចុប្បន្ន!');
      },
      () => {
        onUpdateDriverCoords(currentOrder.id, { lat: shopSettings.lat, lng: shopSettings.lng }, 'Ready');
        onToast(
          isEn ? 'GPS blocked — synced position at Shop.' : 'GPS ត្រូវបានបិទ — បានផ្ញើទីតាំងពីហាងជំនួស!'
        );
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 5000 }
    );
  };

  const handleAcceptAndPickup = () => {
    if (!currentOrder) return;
    const savedInfo: DriverInfo = {
      ...currentOrder.driverInfo,
      name: driverProfile.name.trim() || currentOrder.driverInfo?.name || (isEn ? 'Driver' : 'អ្នកដឹកជញ្ជូន'),
      phone: driverProfile.phone.trim() || currentOrder.driverInfo?.phone,
      pickedUpAt: currentOrder.driverInfo?.pickedUpAt || Date.now(),
    };
    onUpdateDriverInfo(currentOrder.id, savedInfo, 'Ready');
    if (!currentOrder.driverCoords) {
      onUpdateDriverCoords(currentOrder.id, { lat: shopSettings.lat, lng: shopSettings.lng }, 'Ready');
    }
    onToast(isEn ? '✓ Accepted & Out for Delivery!' : '✓ បានទទួលដឹក និងចាប់ផ្តើមចេញដំណើរ!');
  };

  const handleMarkArrived = () => {
    if (!currentOrder) return;
    onUpdateDriverInfo(currentOrder.id, {
      ...currentOrder.driverInfo,
      arrivedAt: Date.now(),
    });
    onToast(
      isEn ? '✓ Customer notified that you have arrived!' : '✓ បានជូនដំណឹងថាអ្នកដឹកមកដល់ទីតាំងហើយ!'
    );
  };

  const handleSaveDriverProfile = () => {
    safeSet('cafe_driver_profile_v15', driverProfile);
    if (currentOrder) {
      onUpdateDriverInfo(currentOrder.id, {
        ...currentOrder.driverInfo,
        name: driverProfile.name.trim() || undefined,
        phone: driverProfile.phone.trim() || undefined,
      });
    }
    setEditingDriver(false);
    onToast(isEn ? '✓ Driver profile saved!' : '✓ បានរក្សាទុកព័ត៌មានអ្នកដឹក!');
  };

  const visibleList = queueTab === 'active' ? activeDeliveries : completedDeliveries;

  return (
    <div className="max-w-lg mx-auto min-h-screen bg-white shadow-xl flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-900 flex items-center justify-center shrink-0">
            <Truck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-sm truncate">
              {isEn ? 'Delivery Driver Portal' : 'ផ្ទាំងអ្នកដឹកជញ្ជូន (Driver)'}
            </h2>
            <p className="text-[11px] text-amber-300 font-mono-num truncate">
              {activeDeliveries.length} {isEn ? 'active' : 'កំពុងដឹក'} · {completedDeliveries.length}{' '}
              {isEn ? 'done' : 'រួច'} · COD ${codCollectedToday.toFixed(2)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onChangeLang && (
            <button
              type="button"
              onClick={() => onChangeLang(isEn ? 'km' : 'en')}
              className="bg-white/10 hover:bg-white/20 px-2.5 py-2 rounded-xl text-[11px] font-bold flex items-center gap-1"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{isEn ? 'ខ្មែរ' : 'EN'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            className="bg-white/15 hover:bg-white/25 px-3 py-2 rounded-xl text-xs font-bold"
          >
            {isEn ? 'Back' : 'ត្រឡប់'}
          </button>
        </div>
      </div>

      {/* Queue Tabs + Order Switcher */}
      <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 bg-white p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setQueueTab('active')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                queueTab === 'active' ? 'bg-[#0D4A3E] text-white' : 'text-slate-600'
              }`}
            >
              {isEn ? `Active (${activeDeliveries.length})` : `សកម្ម (${activeDeliveries.length})`}
            </button>
            <button
              type="button"
              onClick={() => setQueueTab('completed')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${
                queueTab === 'completed' ? 'bg-[#0D4A3E] text-white' : 'text-slate-600'
              }`}
            >
              {isEn ? `Completed (${completedDeliveries.length})` : `រួចរាល់ (${completedDeliveries.length})`}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setEditingDriver((v) => !v)}
            className="text-[11px] font-bold text-[#0D4A3E] bg-[#E8F2EF] px-2.5 py-1.5 rounded-xl flex items-center gap-1"
          >
            <UserCheck className="w-3.5 h-3.5" />
            <span>
              {driverProfile.name ? driverProfile.name : isEn ? 'Driver Info' : 'ព័ត៌មានអ្នកដឹក'}
            </span>
          </button>
        </div>

        {editingDriver && (
          <div className="bg-white p-2.5 rounded-xl border border-slate-200 space-y-2">
            <div className="grid grid-cols-2 gap-1.5">
              <input
                type="text"
                value={driverProfile.name}
                onChange={(e) => setDriverProfile((p) => ({ ...p, name: e.target.value }))}
                placeholder={isEn ? 'Driver Name' : 'ឈ្មោះអ្នកដឹក'}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs"
              />
              <input
                type="tel"
                value={driverProfile.phone}
                onChange={(e) => setDriverProfile((p) => ({ ...p, phone: e.target.value }))}
                placeholder={isEn ? 'Driver Phone' : 'លេខទូរស័ព្ទ'}
                className="px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono-num"
              />
            </div>
            <button
              type="button"
              onClick={handleSaveDriverProfile}
              className="w-full bg-[#0D4A3E] text-white font-bold py-1.5 rounded-lg text-xs"
            >
              {isEn ? 'Save Driver Profile' : 'រក្សាទុកព័ត៌មានអ្នកដឹក'}
            </button>
          </div>
        )}

        {visibleList.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto hide-scrollbar pb-0.5">
            {visibleList.map((o) => {
              const selected = currentOrder?.id === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onSelectOrder(o.id)}
                  className={`px-3 py-1.5 rounded-xl text-left border shrink-0 transition-colors ${
                    selected
                      ? 'bg-[#0D4A3E] text-white border-[#0D4A3E]'
                      : 'bg-white text-slate-700 border-slate-200'
                  }`}
                >
                  <p className="text-[11px] font-bold font-mono-num">{o.id}</p>
                  <p className={`text-[10px] truncate max-w-[110px] ${selected ? 'text-emerald-200' : 'text-slate-500'}`}>
                    {o.customer?.name || '-'} · ${Number(o.grandTotal || 0).toFixed(2)}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!currentOrder ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-[#E8F2EF] text-[#0D4A3E] flex items-center justify-center">
            <Truck className="w-8 h-8" />
          </div>
          <h3 className="font-bold text-base text-slate-900">
            {isEn ? 'No Delivery Orders in Queue' : 'មិនមានការកម្ម៉ង់ដឹកជញ្ជូនទេ'}
          </h3>
          <p className="text-xs text-slate-500 max-w-xs">
            {isEn
              ? 'New delivery orders will appear here automatically so you can navigate and track live GPS.'
              : 'ពេលមានភ្ញៀវកម្ម៉ង់ដឹកជញ្ជូន ការកម្ម៉ង់នឹងបង្ហាញនៅទីនេះដោយស្វ័យប្រវត្តិ។'}
          </p>
        </div>
      ) : (
        <>
          <div className="relative w-full bg-slate-100 h-[280px] sm:h-[320px] shrink-0">
            <div ref={mapElRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
            <div className="absolute top-3 left-12 z-[400] bg-slate-900/85 text-white px-3 py-1.5 rounded-xl text-xs font-bold font-mono-num flex items-center gap-2">
              <span>{distKm.toFixed(2)} km</span>
              <span className="text-amber-300">~{etaMins} min</span>
            </div>
            <div className="absolute top-3 right-3 z-[400] flex gap-1 bg-white/95 p-1 rounded-xl shadow border border-slate-200/80">
              <button
                type="button"
                onClick={() => switchStyle('street')}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                  mapStyle === 'street' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                }`}
              >
                {isEn ? 'Map' : 'ផែនទី'}
              </button>
              <button
                type="button"
                onClick={() => switchStyle('satellite')}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                  mapStyle === 'satellite' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                }`}
              >
                {isEn ? 'Satellite' : 'ផ្កាយរណប'}
              </button>
            </div>
            <button
              type="button"
              onClick={fitRoute}
              className="absolute bottom-6 right-3 z-[400] bg-white text-[#0D4A3E] font-bold text-[11px] px-2.5 py-2 rounded-xl shadow-md flex items-center gap-1 border border-slate-200"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              <span>{isEn ? 'Fit Route' : 'មើលផ្លូវ'}</span>
            </button>
          </div>

          <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 flex-1 overflow-y-auto">
            {/* COD vs KHQR Payment Callout */}
            <div
              className={`p-3 rounded-2xl border flex items-center justify-between gap-2 text-xs font-bold ${
                currentOrder.payment === 'Cash'
                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                  : 'bg-emerald-50 border-emerald-200 text-[#0D4A3E]'
              }`}
            >
              <span className="flex items-center gap-1.5">
                {currentOrder.payment === 'Cash' ? (
                  <Banknote className="w-4 h-4 text-amber-700 shrink-0" />
                ) : (
                  <QrCode className="w-4 h-4 text-[#0D4A3E] shrink-0" />
                )}
                <span>
                  {currentOrder.payment === 'Cash'
                    ? isEn
                      ? 'Cash on Delivery — Collect:'
                      : 'ត្រូវប្រមូលប្រាក់សុទ្ធ (COD)៖'
                    : isEn
                      ? 'KHQR / ABA — Verify payment slip:'
                      : 'ទូទាត់ KHQR / ABA — ពិនិត្យវិក្កយបត្រ៖'}
                </span>
              </span>
              <span className="font-mono-num text-base font-extrabold">
                ${Number(currentOrder.grandTotal || 0).toFixed(2)}
              </span>
            </div>

            {/* Customer Card */}
            <div className="bg-[#E8F2EF] p-3.5 rounded-2xl space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm text-slate-900 truncate">
                      {currentOrder.customer?.name || '-'}
                    </p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-white text-[#0D4A3E]">
                      {getOrderStatusText(currentOrder.status, lang)}
                    </span>
                  </div>
                  <p className="text-xs font-mono-num text-slate-700 mt-0.5">
                    {currentOrder.customer?.phone || '-'}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    📍 {currentOrder.customer?.addressName || (isEn ? 'Pinned on Map' : 'ទីតាំងលើផែនទី')}
                    {currentOrder.customer?.addressNote ? ` · ${currentOrder.customer.addressNote}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={`tel:${currentOrder.customer?.phone || ''}`}
                  className="flex-1 bg-[#0D4A3E] text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>{isEn ? 'Call Customer' : 'តេទៅភ្ញៀវ'}</span>
                </a>
                {currentOrder.customer?.tg && (
                  <a
                    href={`https://t.me/${encodeURIComponent(
                      currentOrder.customer.tg.replace('@', '')
                    )}?text=${encodeURIComponent(
                      isEn
                        ? `Hello! I am your delivery driver for order ${currentOrder.id}.`
                        : `សួស្តី! ខ្ញុំជាអ្នកដឹកជញ្ជូនសម្រាប់ការកម្ម៉ង់ ${currentOrder.id}`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 bg-sky-600 text-white px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Telegram</span>
                  </a>
                )}
              </div>
            </div>

            {/* Interactive Packing Checklist */}
            <div className="bg-slate-50 border border-slate-200/80 p-3 rounded-2xl space-y-2">
              <p className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                <ClipboardCheck className="w-3.5 h-3.5 text-[#0D4A3E]" />
                <span>
                  {isEn
                    ? `Order Packing Checklist (${currentOrder.items.length} items)`
                    : `ពិនិត្យទំនិញមុនចេញដឹក (${currentOrder.items.length} មុខ)`}
                </span>
              </p>
              <div className="space-y-1.5">
                {currentOrder.items.map((it, idx) => {
                  const key = `${currentOrder.id}-${idx}`;
                  const checked = Boolean(checkedItems[key]);
                  return (
                    <label
                      key={key}
                      className={`flex items-center gap-2.5 p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                        checked
                          ? 'bg-emerald-50/70 border-emerald-200 text-slate-500 line-through'
                          : 'bg-white border-slate-200 text-slate-900'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setCheckedItems((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                        className="accent-[#0D4A3E] w-4 h-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <strong>
                          {it.qty}x {it.name}
                        </strong>{' '}
                        <span className="text-slate-500">({it.options})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Driver Step Actions */}
            {currentOrder.status !== 'Completed' ? (
              <div className="space-y-2">
                {currentOrder.status !== 'Ready' && (
                  <button
                    type="button"
                    onClick={handleAcceptAndPickup}
                    className="w-full bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-3 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-sm"
                  >
                    <Truck className="w-4 h-4" />
                    <span>
                      {isEn
                        ? 'Accept & Start Delivery (Out for Delivery)'
                        : '🛵 ទទួលការដឹក & ចេញដំណើរពីហាង'}
                    </span>
                  </button>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={toggleLiveGPS}
                    className={`col-span-2 font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 ${
                      gpsActive ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
                    }`}
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>
                      {gpsActive
                        ? isEn
                          ? 'Live GPS Active (Stop)'
                          : 'កំពុងផ្ញើ Live GPS (បិទ)'
                        : isEn
                          ? 'Start Live GPS'
                          : '📡 បើក Live GPS'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSingleGpsPing}
                    className="bg-[#E8F2EF] text-[#0D4A3E] font-bold py-2.5 px-2 rounded-xl text-xs flex items-center justify-center gap-1"
                  >
                    <LocateFixed className="w-3.5 h-3.5" />
                    <span>{isEn ? 'Ping GPS' : 'ផ្ញើទីតាំង'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${cLat},${cLng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2.5 px-3 rounded-xl text-xs text-center flex items-center justify-center gap-1"
                  >
                    <MapPin className="w-3.5 h-3.5 text-[#0D4A3E]" />
                    <span>{isEn ? 'Google Maps' : 'បើក Google Maps'}</span>
                  </a>
                  <button
                    type="button"
                    onClick={handleMarkArrived}
                    className={`font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1 ${
                      currentOrder.driverInfo?.arrivedAt
                        ? 'bg-emerald-100 text-[#0D4A3E]'
                        : 'bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {currentOrder.driverInfo?.arrivedAt
                        ? isEn
                          ? 'Arrived ✓'
                          : 'បានដល់ហើយ ✓'
                        : isEn
                          ? 'Mark Arrived'
                          : 'មកដល់ទីតាំងហើយ'}
                    </span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onCompleteDelivery(currentOrder.id);
                    const nextActive = activeDeliveries.find((o) => o.id !== currentOrder.id);
                    if (nextActive) {
                      onSelectOrder(nextActive.id);
                    }
                  }}
                  className="w-full bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-3 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {isEn ? 'Complete Delivery (Handed to Customer)' : '✅ ដឹកដល់ដៃភ្ញៀវរួចរាល់'}
                  </span>
                </button>
              </div>
            ) : (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3 text-center text-xs font-bold text-[#0D4A3E]">
                {isEn
                  ? '✓ This delivery is marked as Completed.'
                  : '✓ ការដឹកជញ្ជូននេះត្រូវបានបញ្ចប់ដោយជោគជ័យ!'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
