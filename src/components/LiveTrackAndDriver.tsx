import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import L from 'leaflet';
import { LocateFixed, MapPin, Navigation, Phone, X } from 'lucide-react';
import type { Coords, Order, ShopSettings } from '../types';
import { getDistanceKm } from '../utils/cafeUtils';
import { makeResilientTileLayer } from './LocationPickerModal';

interface LiveTrackModalProps {
  order: Order | null;
  shopSettings: ShopSettings;
  onClose: () => void;
  onUpdateCustomerCoords: (orderId: string, coords: Coords) => void;
  onOpenDriverConsole: (orderId: string) => void;
  onToast: (msg: string) => void;
}

export function LiveTrackModal({
  order,
  shopSettings,
  onClose,
  onUpdateCustomerCoords,
  onOpenDriverConsole,
  onToast,
}: LiveTrackModalProps) {
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
      html: '<div style="background:#D99B26;color:#000;padding:2px 7px;border-radius:10px;font-weight:bold;font-size:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap;">☕ ហាង</div>',
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
  }, [order, cLat, cLng, dLat, dLng, shopSettings.lat, shopSettings.lng]);

  const handleShareLivePin = () => {
    if (!order || !navigator.geolocation) {
      onToast('សូមបើក GPS លើទូរស័ព្ទ!');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onUpdateCustomerCoords(order.id, { lat: p.coords.latitude, lng: p.coords.longitude });
        onToast('បានអាប់ដេតទីតាំង Live ហើយ!');
      },
      () => onToast('សូមបើក GPS លើទូរស័ព្ទ!'),
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
                <h3 className="font-bold text-base">🛵 តាមដានអ្នកដឹក Live</h3>
                <p className="text-[11px] text-emerald-200 font-mono-num">
                  {order.id} · {order.status === 'Completed' ? 'ដល់ដៃភ្ញៀវហើយ' : 'កំពុងដឹកជញ្ជូន'}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="បិទ"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-white/15 rounded-full"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-amber-50 border-b border-amber-100 px-4 py-2.5 flex items-center justify-between text-xs shrink-0">
              <span className="font-bold text-slate-800">
                {dist < 0.05 ? '🎉 អ្នកដឹកមកដល់ទីតាំងអ្នកហើយ!' : `🛵 ប្រហែល ${mins} នាទីទៀតដល់`}
              </span>
              <span className="font-bold font-mono-num text-[#0D4A3E]">{dist.toFixed(2)} km</span>
            </div>

            <div className="relative flex-1 bg-slate-100 min-h-[280px] h-[320px]">
              <div ref={mapElRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
              <div className="absolute top-3 right-3 z-[400] flex gap-1 bg-white/95 p-1 rounded-xl shadow border border-slate-200/80">
                <button
                  type="button"
                  onClick={() => switchStyle('street')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                    mapStyle === 'street' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                  }`}
                >
                  ផែនទី
                </button>
                <button
                  type="button"
                  onClick={() => switchStyle('satellite')}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
                    mapStyle === 'satellite' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                  }`}
                >
                  ផ្កាយរណប
                </button>
              </div>
              <button
                type="button"
                onClick={fitAllMarkers}
                className="absolute bottom-6 right-3 z-[400] bg-white text-[#0D4A3E] font-bold text-[11px] px-2.5 py-2 rounded-xl shadow-md flex items-center gap-1 border border-slate-200"
              >
                <LocateFixed className="w-3.5 h-3.5" />
                <span>មើលទាំងអស់</span>
              </button>
            </div>

            <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2 shrink-0 bg-white border-t border-slate-100">
              <button
                type="button"
                onClick={handleShareLivePin}
                className="w-full bg-[#E8F2EF] text-[#0D4A3E] font-bold py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5"
              >
                <MapPin className="w-4 h-4" />
                <span>អាប់ដេតទីតាំង Live ខ្ញុំឱ្យអ្នកដឹកឃើញ</span>
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onOpenDriverConsole(order.id)}
                  className="bg-amber-400 hover:bg-amber-500 text-slate-900 font-bold py-2.5 rounded-xl text-xs"
                >
                  🛵 ទម្រង់អ្នកដឹក
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="bg-slate-900 text-white font-bold py-2.5 rounded-xl text-xs"
                >
                  បិទ
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
  order: Order;
  shopSettings: ShopSettings;
  onExit: () => void;
  onUpdateDriverCoords: (orderId: string, coords: Coords, status?: Order['status']) => void;
  onCompleteDelivery: (orderId: string) => void;
  onToast: (msg: string) => void;
}

export function DriverConsole({
  order,
  shopSettings,
  onExit,
  onUpdateDriverCoords,
  onCompleteDelivery,
  onToast,
}: DriverConsoleProps) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const custMarkerRef = useRef<L.Marker | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const lastGpsSentAtRef = useRef(0);
  const lastGpsCoordsRef = useRef<Coords | null>(null);
  const [gpsActive, setGpsActive] = useState(false);
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');

  const cLat = order.customer?.coords?.lat ?? shopSettings.lat;
  const cLng = order.customer?.coords?.lng ?? shopSettings.lng;
  const dLat = order.driverCoords?.lat ?? shopSettings.lat;
  const dLng = order.driverCoords?.lng ?? shopSettings.lng;
  const distKm = getDistanceKm(dLat, dLng, cLat, cLng);

  const fitRoute = () => {
    if (!mapRef.current) return;
    try {
      mapRef.current.fitBounds(
        [
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
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchStyle = (mode: 'street' | 'satellite') => {
    setMapStyle(mode);
    if (!mapRef.current) return;
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = makeResilientTileLayer(mode).addTo(mapRef.current);
  };

  useEffect(() => {
    if (!mapRef.current) return;
    const m = mapRef.current;
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
  }, [cLat, cLng, dLat, dLng]);

  const toggleLiveGPS = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      setGpsActive(false);
      return;
    }
    if (!navigator.geolocation) {
      onToast('ឧបករណ៍នេះមិនគាំទ្រ GPS ទេ!');
      return;
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
        onUpdateDriverCoords(order.id, nextCoords, 'Ready');
      },
      () => {
        onToast('មិនអាចចាប់សញ្ញា GPS បានទេ! សូមបើក Location Services លើទូរស័ព្ទ');
        setGpsActive(false);
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
  };

  return (
    <div className="max-w-lg mx-auto min-h-screen bg-white shadow-xl flex flex-col">
      <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🛵</span>
          <div>
            <h2 className="font-bold text-sm">អ្នកដឹកជញ្ជូន (Live GPS)</h2>
            <p className="text-[11px] text-amber-300 font-mono-num">
              {order.id} · ${Number(order.grandTotal || 0).toFixed(2)} ({order.payment})
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onExit}
          className="bg-white/15 hover:bg-white/25 px-3.5 py-2 rounded-xl text-xs font-bold"
        >
          ត្រឡប់
        </button>
      </div>

      <div className="relative w-full bg-slate-100 h-[360px]">
        <div ref={mapElRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
        <div className="absolute top-3 left-12 z-[400] bg-slate-900/85 text-white px-3 py-1.5 rounded-xl text-xs font-bold font-mono-num">
          នៅសល់៖ {distKm.toFixed(2)} km
        </div>
        <div className="absolute top-3 right-3 z-[400] flex gap-1 bg-white/95 p-1 rounded-xl shadow border border-slate-200/80">
          <button
            type="button"
            onClick={() => switchStyle('street')}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
              mapStyle === 'street' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
            }`}
          >
            ផែនទី
          </button>
          <button
            type="button"
            onClick={() => switchStyle('satellite')}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold ${
              mapStyle === 'satellite' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
            }`}
          >
            ផ្កាយរណប
          </button>
        </div>
        <button
          type="button"
          onClick={fitRoute}
          className="absolute bottom-6 right-3 z-[400] bg-white text-[#0D4A3E] font-bold text-[11px] px-2.5 py-2 rounded-xl shadow-md flex items-center gap-1 border border-slate-200"
        >
          <LocateFixed className="w-3.5 h-3.5" />
          <span>មើលផ្លូវ</span>
        </button>
      </div>

      <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
        <div className="bg-[#E8F2EF] p-3.5 rounded-2xl flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold text-sm text-slate-900 truncate">
              {order.customer?.name || '-'} ({order.customer?.phone || '-'})
            </p>
            <p className="text-xs text-slate-600 truncate">
              {order.customer?.addressName || 'ទីតាំងលើផែនទី'}
              {order.customer?.addressNote ? ` · ${order.customer.addressNote}` : ''}
            </p>
          </div>
          <a
            href={`tel:${order.customer?.phone || ''}`}
            className="bg-[#0D4A3E] text-white px-3 py-2 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1"
          >
            <Phone className="w-3.5 h-3.5" />
            <span>តេទៅភ្ញៀវ</span>
          </a>
        </div>

        <div className="bg-slate-50 p-3 rounded-xl text-xs space-y-1">
          {order.items.map((i, idx) => (
            <div key={idx}>
              <strong>
                {i.qty}x {i.name}
              </strong>{' '}
              ({i.options})
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={toggleLiveGPS}
          className={`w-full font-bold py-3 rounded-2xl text-sm flex items-center justify-center gap-2 ${
            gpsActive ? 'bg-red-600 text-white' : 'bg-amber-400 text-slate-900'
          }`}
        >
          <Navigation className="w-4 h-4" />
          <span>{gpsActive ? 'កំពុងផ្ញើ Live GPS... (ចុចដើម្បីបិទ)' : '📡 បើក Live GPS ផ្ញើទីតាំង'}</span>
        </button>

        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${cLat},${cLng}`}
          target="_blank"
          rel="noreferrer"
          className="w-full bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold py-2.5 rounded-xl text-xs text-center flex items-center justify-center"
        >
          🗺️ បើកផ្លូវបង្ហាញទិសដៅក្នុង Google Maps
        </a>

        <button
          type="button"
          onClick={() => onCompleteDelivery(order.id)}
          className="w-full bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-3 rounded-2xl text-sm"
        >
          ✅ ដឹកដល់ដៃភ្ញៀវរួចរាល់
        </button>
      </div>
    </div>
  );
}
