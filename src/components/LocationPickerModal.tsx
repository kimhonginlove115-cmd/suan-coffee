import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import L from 'leaflet';
import { Crosshair, MapPin, Search, X } from 'lucide-react';
import type { Coords, ShopSettings } from '../types';
import { computeDeliveryFee, getDistanceKm } from '../utils/cafeUtils';

interface LocationPickerModalProps {
  isOpen: boolean;
  purpose: 'customer' | 'shop';
  shopSettings: ShopSettings;
  initialCoords: Coords;
  initialAddress: string;
  cartSubtotal: number;
  onClose: () => void;
  onConfirmCustomer: (coords: Coords, addressName: string, distanceKm: number, fee: number) => void;
  onConfirmShop: (coords: Coords) => void;
  onToast: (msg: string) => void;
}

const LANDMARKS = [
  { lat: 11.5504, lng: 104.9225, label: 'BKK1 (បឹងកេងកង ១)', short: 'BKK1' },
  { lat: 11.5761, lng: 104.8977, label: 'Toul Kork (ទួលគោក)', short: 'ទួលគោក' },
  { lat: 11.5477, lng: 104.9333, label: 'Aeon Mall 1', short: 'Aeon 1' },
  { lat: 11.5997, lng: 104.8851, label: 'Aeon Mall 2', short: 'Aeon 2' },
  { lat: 11.5681, lng: 104.931, label: 'មាត់ទន្លេ (Riverside)', short: 'មាត់ទន្លេ' },
];

export function makeResilientTileLayer(mode: 'street' | 'satellite') {
  const url =
    mode === 'satellite'
      ? 'https://mt1.google.com/vt/lyrs=y&hl=km&x={x}&y={y}&z={z}'
      : 'https://mt1.google.com/vt/lyrs=m&hl=km&x={x}&y={y}&z={z}';
  const fallbackUrl =
    mode === 'satellite'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';

  const tl = L.tileLayer(url, { maxZoom: 20 });
  let loadedAny = false;
  let switched = false;
  tl.on('tileload', () => {
    loadedAny = true;
  });
  tl.on('tileerror', () => {
    if (!switched) {
      switched = true;
      tl.setUrl(fallbackUrl);
    }
  });
  setTimeout(() => {
    if (!loadedAny && !switched) {
      switched = true;
      tl.setUrl(fallbackUrl);
    }
  }, 3500);
  return tl;
}

export function LocationPickerModal({
  isOpen,
  purpose,
  shopSettings,
  initialCoords,
  initialAddress,
  cartSubtotal,
  onClose,
  onConfirmCustomer,
  onConfirmShop,
  onToast,
}: LocationPickerModalProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const shopMarkerRef = useRef<L.Marker | null>(null);
  const geoAbortRef = useRef<AbortController | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipMoveEndRef = useRef(false);
  const hasPickedRef = useRef(false);

  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [searchQuery, setSearchQuery] = useState('');
  const [gpsNote, setGpsNote] = useState('អូសផែនទីឱ្យចំទីតាំង');
  const [centerCoords, setCenterCoords] = useState<Coords>(initialCoords);
  const [addressText, setAddressText] = useState(initialAddress);

  const distKm = getDistanceKm(shopSettings.lat, shopSettings.lng, centerCoords.lat, centerCoords.lng);
  const fee = computeDeliveryFee(shopSettings, distKm, cartSubtotal);

  const reverseGeocode = (lat: number, lng: number) => {
    setAddressText(`ទីតាំង (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    if (geoAbortRef.current) geoAbortRef.current.abort();

    geocodeTimerRef.current = setTimeout(async () => {
      try {
        const ctrl = new AbortController();
        geoAbortRef.current = ctrl;
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&accept-language=km,en&lat=${lat}&lon=${lng}`,
          { signal: ctrl.signal }
        );
        const d = await r.json();
        if (d && d.display_name) {
          setAddressText(d.display_name.split(',').slice(0, 3).join(', '));
        }
      } catch {
        // ignore abort or offline
      }
    }, 450);
  };

  useEffect(() => {
    if (!isOpen) {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        tileLayerRef.current = null;
        shopMarkerRef.current = null;
      }
      return;
    }

    const startCoords = purpose === 'shop' ? { lat: shopSettings.lat, lng: shopSettings.lng } : initialCoords;
    setCenterCoords(startCoords);
    if (purpose === 'shop') {
      setGpsNote('អូសផែនទីឱ្យចំទីតាំងហាងរបស់អ្នក');
      setAddressText(`ទីតាំងហាង (${startCoords.lat.toFixed(5)}, ${startCoords.lng.toFixed(5)})`);
    } else {
      setAddressText(initialAddress || 'ភ្នំពេញ');
    }

    const initTimer = setTimeout(() => {
      if (!mapContainerRef.current || mapRef.current) return;
      const m = L.map(mapContainerRef.current, { zoomControl: true }).setView(
        [startCoords.lat, startCoords.lng],
        16
      );
      const tl = makeResilientTileLayer(mapStyle).addTo(m);
      const shopIcon = L.divIcon({
        className: 'custom-gps-icon',
        html: '<div style="background:#D99B26;color:#000;padding:3px 8px;border-radius:10px;font-weight:bold;font-size:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap;">☕ ហាង</div>',
        iconSize: [54, 24],
        iconAnchor: [27, 12],
      });
      const sm = L.marker([shopSettings.lat, shopSettings.lng], { icon: shopIcon }).addTo(m);

      m.on('dragstart', () => {
        skipMoveEndRef.current = false;
      });
      m.on('moveend', () => {
        const c = m.getCenter();
        setCenterCoords({ lat: c.lat, lng: c.lng });
        if (purpose === 'shop') {
          setAddressText(`ទីតាំងហាង (${c.lat.toFixed(5)}, ${c.lng.toFixed(5)})`);
        } else {
          if (skipMoveEndRef.current) {
            skipMoveEndRef.current = false;
            return;
          }
          hasPickedRef.current = true;
          reverseGeocode(c.lat, c.lng);
        }
      });

      mapRef.current = m;
      tileLayerRef.current = tl;
      shopMarkerRef.current = sm;
      setTimeout(() => m.invalidateSize(), 260);

      if (purpose === 'customer' && !hasPickedRef.current) {
        detectUserGPS(false);
      }
    }, 180);

    return () => clearTimeout(initTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, purpose]);

  const switchStyle = (mode: 'street' | 'satellite') => {
    setMapStyle(mode);
    if (!mapRef.current) return;
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = makeResilientTileLayer(mode).addTo(mapRef.current);
  };

  const jumpTo = (lat: number, lng: number, label?: string) => {
    if (label) {
      skipMoveEndRef.current = true;
      setAddressText(label);
    }
    setCenterCoords({ lat, lng });
    hasPickedRef.current = true;
    if (mapRef.current) mapRef.current.setView([lat, lng], 16, { animate: true });
    if (!label && purpose === 'customer') reverseGeocode(lat, lng);
  };

  const fallbackIPLocation = async () => {
    try {
      const res = await fetch('https://get.geojs.io/v1/ip/geo.json');
      const d = await res.json();
      if (d?.latitude && d?.longitude) {
        const lat = parseFloat(d.latitude);
        const lng = parseFloat(d.longitude);
        if (mapRef.current) {
          skipMoveEndRef.current = true;
          mapRef.current.setView([lat, lng], 14, { animate: true });
        }
        setCenterCoords({ lat, lng });
        if (purpose === 'customer') reverseGeocode(lat, lng);
      }
    } catch {
      // ignore
    }
  };

  const detectUserGPS = (showAlert: boolean) => {
    setGpsNote('កំពុងចាប់ទីតាំង GPS...');
    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch {
      inIframe = true;
    }
    if (!navigator.geolocation) {
      setGpsNote('សូមអូសផែនទីដើម្បីរើសទីតាំង');
      if (!hasPickedRef.current) fallbackIPLocation();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsNote('ចាប់ទីតាំង GPS បានជោគជ័យ!');
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (mapRef.current) {
          skipMoveEndRef.current = true;
          mapRef.current.setView([lat, lng], 17, { animate: true });
        }
        setCenterCoords({ lat, lng });
        hasPickedRef.current = true;
        if (purpose === 'customer') reverseGeocode(lat, lng);
      },
      () => {
        if (!hasPickedRef.current && purpose === 'customer') fallbackIPLocation();
        setGpsNote(
          inIframe
            ? 'Iframe បិទ GPS! សូមអូសផែនទី ឬជ្រើសតំបន់ខាងលើ'
            : 'សូមអូសផែនទី ឬចុចតំបន់ខាងលើ'
        );
        if (showAlert) {
          onToast('សូមបើក Location Services ឬអូសផែនទីដោយដៃ');
        }
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    const coordMatch = q.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
    if (coordMatch) {
      jumpTo(parseFloat(coordMatch[1]), parseFloat(coordMatch[2]));
      return;
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&accept-language=km,en&countrycodes=kh&limit=1&q=${encodeURIComponent(q)}`
      );
      const d = await res.json();
      if (d && d.length > 0) {
        jumpTo(parseFloat(d[0].lat), parseFloat(d[0].lon), d[0].display_name.split(',').slice(0, 2).join(', '));
      } else {
        onToast('រកមិនឃើញទីតាំងនេះទេ!');
      }
    } catch {
      onToast('មិនអាចស្វែងរកទីតាំងបានទេ សូមអូសផែនទី!');
    }
  };

  const handlePaste = async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // clipboard denied
    }
    if (text) {
      setSearchQuery(text);
      const coordMatch = text.match(/(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/);
      if (coordMatch) {
        jumpTo(parseFloat(coordMatch[1]), parseFloat(coordMatch[2]));
      }
    } else {
      onToast('សូម Paste Link ឬកូអរដោនេចូលក្នុងប្រអប់ស្វែងរក');
    }
  };

  const handleConfirm = () => {
    const finalCoords = mapRef.current
      ? { lat: mapRef.current.getCenter().lat, lng: mapRef.current.getCenter().lng }
      : centerCoords;
    if (purpose === 'shop') {
      onConfirmShop({
        lat: parseFloat(finalCoords.lat.toFixed(5)),
        lng: parseFloat(finalCoords.lng.toFixed(5)),
      });
    } else {
      const d = getDistanceKm(shopSettings.lat, shopSettings.lng, finalCoords.lat, finalCoords.lng);
      const f = computeDeliveryFee(shopSettings, d, cartSubtotal);
      onConfirmCustomer(finalCoords, addressText, d, f);
    }
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center"
        >
          <motion.div
            initial={{ y: 36, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 36, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col"
            style={{ height: '90vh', maxHeight: '760px' }}
          >
            <div className="p-4 bg-[#0D4A3E] text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-sm">
                  {purpose === 'shop' ? 'កំណត់ទីតាំងហាងរបស់អ្នក' : 'ជ្រើសរើសទីតាំងដឹកជញ្ជូន'}
                </h3>
                <p className="text-[11px] text-emerald-200">{gpsNote}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="បិទ"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-white/15 rounded-full hover:bg-white/25 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border-b border-slate-200 space-y-2 shrink-0">
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleSearch();
                      }
                    }}
                    placeholder="វាយឈ្មោះតំបន់ ឬ Paste Link Google Maps..."
                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:border-[#0D4A3E]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSearch}
                  className="bg-[#0D4A3E] text-white px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
                >
                  រក
                </button>
                <button
                  type="button"
                  onClick={handlePaste}
                  className="bg-amber-400 text-slate-900 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap"
                >
                  Paste
                </button>
              </div>

              <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
                {LANDMARKS.map((lm) => (
                  <button
                    key={lm.short}
                    type="button"
                    onClick={() => jumpTo(lm.lat, lm.lng, lm.label)}
                    className="text-[11px] bg-white border border-slate-200 hover:border-[#0D4A3E] px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors"
                  >
                    {lm.short}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative flex-1 bg-slate-200" style={{ minHeight: '260px' }}>
              <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
              <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full z-[450] flex flex-col items-center">
                <div className="bg-[#0D4A3E] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-lg shadow mb-1 whitespace-nowrap">
                  {purpose === 'shop' ? 'ទីតាំងហាង' : 'ទីតាំងអ្នក'}
                </div>
                <MapPin className="w-8 h-8 text-[#0D4A3E] fill-amber-400 drop-shadow-md" />
              </div>

              <div className="absolute top-3 right-3 z-[400] flex gap-1 bg-white/95 p-1 rounded-xl shadow">
                <button
                  type="button"
                  onClick={() => switchStyle('street')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                    mapStyle === 'street' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                  }`}
                >
                  ផែនទី
                </button>
                <button
                  type="button"
                  onClick={() => switchStyle('satellite')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                    mapStyle === 'satellite' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                  }`}
                >
                  ផ្កាយរណប
                </button>
              </div>

              <button
                type="button"
                onClick={() => detectUserGPS(true)}
                className="absolute bottom-3 right-3 z-[400] bg-white text-[#0D4A3E] font-bold text-xs px-3.5 py-2.5 rounded-xl shadow-lg flex items-center gap-1.5 border border-slate-200"
              >
                <Crosshair className="w-4 h-4" />
                <span>ចាប់ទីតាំង GPS ខ្ញុំ</span>
              </button>
            </div>

            <div className="p-4 bg-white border-t border-slate-200 space-y-2.5 shrink-0">
              <div className="bg-[#E8F2EF] text-[#0D4A3E] p-3 rounded-2xl text-xs">
                <p className="font-bold truncate">{addressText}</p>
                <p className="text-[11px] font-mono-num mt-0.5">
                  {purpose === 'shop'
                    ? 'ចុចបញ្ជាក់ដើម្បីរក្សាទុកទីតាំងហាង'
                    : `ចម្ងាយពីហាង៖ ${distKm.toFixed(2)} km · ថ្លៃដឹក៖ $${fee.toFixed(2)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleConfirm}
                className="w-full bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-3 rounded-2xl text-sm transition-colors"
              >
                បញ្ជាក់ទីតាំងនេះ
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
