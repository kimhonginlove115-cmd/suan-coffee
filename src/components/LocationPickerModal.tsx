import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import L from 'leaflet';
import { Crosshair, MapPin, Search, Store, X } from 'lucide-react';
import type { AppLang, Coords, ShopSettings } from '../types';
import { computeDeliveryFee, extractCoordsFromMapText, fetchWithTimeout, getDistanceKm } from '../utils/cafeUtils';

interface LocationPickerModalProps {
  lang?: AppLang;
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

interface SearchSuggestion {
  label: string;
  lat: number;
  lng: number;
}

const LANDMARKS = [
  { lat: 11.5504, lng: 104.9225, label: 'BKK1 (បឹងកេងកង ១)', short: 'BKK1' },
  { lat: 11.5761, lng: 104.8977, label: 'ទួលគោក (Toul Kork)', short: 'ទួលគោក' },
  { lat: 11.5944, lng: 104.8806, label: 'សែនសុខ (Sen Sok)', short: 'សែនសុខ' },
  { lat: 11.5349, lng: 104.9372, label: 'ច្បារអំពៅ (Chbar Ampov)', short: 'ច្បារអំពៅ' },
  { lat: 11.5477, lng: 104.9333, label: 'Aeon Mall 1', short: 'Aeon 1' },
  { lat: 11.5997, lng: 104.8851, label: 'Aeon Mall 2', short: 'Aeon 2' },
  { lat: 11.5681, lng: 104.931, label: 'មាត់ទន្លេ (Riverside)', short: 'មាត់ទន្លេ' },
  { lat: 11.4793, lng: 104.9482, label: 'ក្រុងតាខ្មៅ (Ta Khmau)', short: 'តាខ្មៅ' },
];

export function makeResilientTileLayer(mode: 'street' | 'satellite') {
  const urls =
    mode === 'satellite'
      ? [
          'https://mt{s}.google.com/vt/lyrs=y&hl=km&x={x}&y={y}&z={z}',
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ]
      : [
          'https://mt{s}.google.com/vt/lyrs=m&hl=km&x={x}&y={y}&z={z}',
          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
        ];

  let urlIndex = 0;
  let loadedAny = false;
  let removed = false;

  const tl = L.tileLayer(urls[0], {
    maxZoom: 20,
    subdomains: ['0', '1', '2', '3'],
  });

  const switchToNextProvider = () => {
    if (removed || urlIndex >= urls.length - 1) return;
    urlIndex += 1;
    try {
      tl.setUrl(urls[urlIndex]);
    } catch {
      // ignore if layer disposed
    }
  };

  const fallbackTimer = setTimeout(() => {
    if (!loadedAny && !removed) {
      switchToNextProvider();
    }
  }, 3500);

  tl.on('tileload', () => {
    loadedAny = true;
    clearTimeout(fallbackTimer);
  });
  tl.on('tileerror', () => {
    if (!loadedAny && !removed) {
      clearTimeout(fallbackTimer);
      switchToNextProvider();
    }
  });
  tl.on('remove', () => {
    removed = true;
    clearTimeout(fallbackTimer);
  });
  return tl;
}

export function LocationPickerModal({
  lang = 'km',
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
  const isEn = lang === 'en';
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const shopMarkerRef = useRef<L.Marker | null>(null);
  const geoAbortRef = useRef<AbortController | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipMoveEndRef = useRef(false);
  const hasPickedRef = useRef(false);
  const isMountedRef = useRef(true);

  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [gpsNote, setGpsNote] = useState(() =>
    lang === 'en' ? 'Drag map to adjust pin location' : 'អូសផែនទីឱ្យចំទីតាំង'
  );
  const [centerCoords, setCenterCoords] = useState<Coords>(initialCoords);
  const [addressText, setAddressText] = useState(initialAddress);

  const distKm = getDistanceKm(shopSettings.lat, shopSettings.lng, centerCoords.lat, centerCoords.lng);
  const fee = computeDeliveryFee(shopSettings, distKm, cartSubtotal);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const reverseGeocode = (lat: number, lng: number) => {
    setAddressText(
      isEn
        ? `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`
        : `ទីតាំង (${lat.toFixed(4)}, ${lng.toFixed(4)})`
    );
    if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
    if (geoAbortRef.current) geoAbortRef.current.abort();

    geocodeTimerRef.current = setTimeout(async () => {
      try {
        const ctrl = new AbortController();
        geoAbortRef.current = ctrl;
        const r = await fetchWithTimeout(
          `https://nominatim.openstreetmap.org/reverse?format=json&accept-language=${isEn ? 'en,km' : 'km,en'}&lat=${lat}&lon=${lng}`,
          { signal: ctrl.signal },
          6500
        );
        if (!r.ok) return;
        const d = await r.json();
        if (isMountedRef.current && d && d.display_name) {
          setAddressText(d.display_name.split(',').slice(0, 3).join(', '));
        }
      } catch {
        // ignore abort, timeout, or offline
      }
    }, 450);
  };

  useEffect(() => {
    if (!isOpen) {
      setSuggestions([]);
      if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
      if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
      if (geoAbortRef.current) geoAbortRef.current.abort();
      if (searchAbortRef.current) searchAbortRef.current.abort();
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
    setSuggestions([]);
    if (purpose === 'shop') {
      setGpsNote(isEn ? 'Drag map to set your shop pin' : 'អូសផែនទីឱ្យចំទីតាំងហាងរបស់អ្នក');
      setAddressText(
        isEn
          ? `Shop Location (${startCoords.lat.toFixed(5)}, ${startCoords.lng.toFixed(5)})`
          : `ទីតាំងហាង (${startCoords.lat.toFixed(5)}, ${startCoords.lng.toFixed(5)})`
      );
    } else {
      setGpsNote(isEn ? 'Drag map to adjust pin location' : 'អូសផែនទីឱ្យចំទីតាំង');
      setAddressText(initialAddress || (isEn ? 'Phnom Penh' : 'ភ្នំពេញ'));
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
        html: `<div style="background:#D99B26;color:#000;padding:3px 8px;border-radius:10px;font-weight:bold;font-size:10px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3);white-space:nowrap;">☕ ${isEn ? 'Shop' : 'ហាង'}</div>`,
        iconSize: [54, 24],
        iconAnchor: [27, 12],
      });
      const sm = L.marker([shopSettings.lat, shopSettings.lng], { icon: shopIcon }).addTo(m);

      m.on('dragstart', () => {
        skipMoveEndRef.current = false;
        setSuggestions([]);
      });
      m.on('moveend', () => {
        if (!mapRef.current) return;
        const c = m.getCenter();
        setCenterCoords({ lat: c.lat, lng: c.lng });
        if (purpose === 'shop') {
          setAddressText(
            isEn
              ? `Shop Location (${c.lat.toFixed(5)}, ${c.lng.toFixed(5)})`
              : `ទីតាំងហាង (${c.lat.toFixed(5)}, ${c.lng.toFixed(5)})`
          );
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
      invalidateTimerRef.current = setTimeout(() => {
        try {
          if (mapRef.current === m) m.invalidateSize();
        } catch {
          // ignore if unmounted
        }
      }, 260);

      if (purpose === 'customer' && !hasPickedRef.current) {
        detectUserGPS(false);
      }
    }, 180);

    return () => {
      clearTimeout(initTimer);
      if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
      if (geocodeTimerRef.current) clearTimeout(geocodeTimerRef.current);
      if (geoAbortRef.current) geoAbortRef.current.abort();
      if (searchAbortRef.current) searchAbortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, purpose]);

  const switchStyle = (mode: 'street' | 'satellite') => {
    setMapStyle(mode);
    if (!mapRef.current) return;
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = makeResilientTileLayer(mode).addTo(mapRef.current);
  };

  const jumpTo = (lat: number, lng: number, label?: string) => {
    setSuggestions([]);
    if (label) {
      skipMoveEndRef.current = true;
      setAddressText(label);
    }
    setCenterCoords({ lat, lng });
    hasPickedRef.current = true;
    if (mapRef.current) {
      try {
        mapRef.current.setView([lat, lng], 16, { animate: true });
      } catch {
        // ignore if disposing
      }
    }
    if (!label && purpose === 'customer') reverseGeocode(lat, lng);
  };

  const fallbackIPLocation = async () => {
    try {
      const res = await fetchWithTimeout('https://get.geojs.io/v1/ip/geo.json', {}, 5000);
      if (!res.ok) return;
      const d = await res.json();
      if (!isMountedRef.current) return;
      if (d?.latitude && d?.longitude) {
        const lat = parseFloat(d.latitude);
        const lng = parseFloat(d.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        if (mapRef.current) {
          skipMoveEndRef.current = true;
          mapRef.current.setView([lat, lng], 14, { animate: true });
        }
        setCenterCoords({ lat, lng });
        if (purpose === 'customer') reverseGeocode(lat, lng);
      }
    } catch {
      // ignore timeout/offline
    }
  };

  const detectUserGPS = (showAlert: boolean) => {
    setGpsNote(isEn ? 'Detecting GPS location...' : 'កំពុងចាប់ទីតាំង GPS...');
    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch {
      inIframe = true;
    }
    if (!navigator.geolocation) {
      setGpsNote(isEn ? 'Drag map to select location' : 'សូមអូសផែនទីដើម្បីរើសទីតាំង');
      if (!hasPickedRef.current) fallbackIPLocation();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!isMountedRef.current) return;
        setGpsNote(isEn ? 'GPS locked successfully!' : 'ចាប់ទីតាំង GPS បានជោគជ័យ!');
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
        if (!isMountedRef.current) return;
        if (!hasPickedRef.current && purpose === 'customer') fallbackIPLocation();
        setGpsNote(
          inIframe
            ? isEn
              ? 'GPS blocked in preview — drag map or pick area above'
              : 'Iframe បិទ GPS! សូមអូសផែនទី ឬជ្រើសតំបន់ខាងលើ'
            : isEn
              ? 'Drag map or pick area above'
              : 'សូមអូសផែនទី ឬចុចតំបន់ខាងលើ'
        );
        if (showAlert) {
          onToast(
            isEn
              ? 'Please enable Location Services or drag the map pin manually'
              : 'សូមបើក Location Services ឬអូសផែនទីដោយដៃ'
          );
        }
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 }
    );
  };

  const runSearchOrResolve = async (rawInput?: string) => {
    const q = (rawInput ?? searchQuery).trim();
    if (!q || searching) return;

    const directCoords = extractCoordsFromMapText(q);
    if (directCoords) {
      jumpTo(directCoords.lat, directCoords.lng);
      onToast('✓ បាននាំទៅកាន់ទីតាំងកូអរដោនេ!');
      return;
    }

    if (searchAbortRef.current) searchAbortRef.current.abort();
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    setSearching(true);
    setSuggestions([]);

    try {
      // Handle Google Maps URLs (including short links like https://maps.app.goo.gl/...)
      const urlMatch = q.match(/https?:\/\/\S+/i);
      if (urlMatch) {
        const res = await fetchWithTimeout(
          `/api/resolve-map-link?url=${encodeURIComponent(urlMatch[0])}`,
          { signal: ctrl.signal },
          8000
        );
        const data = await res.json();
        if (!isMountedRef.current) return;
        if (res.ok && data?.ok && typeof data.lat === 'number' && typeof data.lng === 'number') {
          jumpTo(data.lat, data.lng);
          onToast('✓ បានបើកទីតាំងពី Link Google Maps!');
          return;
        }
        onToast(data?.error || 'មិនអាចទាញកូអរដោនេពី Link នេះបានទេ!');
        return;
      }

      // Primary place search via Nominatim (Cambodia bias)
      let found: SearchSuggestion[] = [];
      try {
        const res = await fetchWithTimeout(
          `https://nominatim.openstreetmap.org/search?format=json&accept-language=km,en&countrycodes=kh&limit=5&q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
          6500
        );
        if (res.ok) {
          const d = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
          if (Array.isArray(d)) {
            found = d
              .map((item) => ({
                label: item.display_name.split(',').slice(0, 3).join(', '),
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
              }))
              .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));
          }
        }
      } catch {
        // Fallback to Photon below
      }

      // Fallback search via Photon if Nominatim returned empty
      if (!found.length && !ctrl.signal.aborted) {
        const pRes = await fetchWithTimeout(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${shopSettings.lat}&lon=${shopSettings.lng}&limit=5`,
          { signal: ctrl.signal },
          6500
        );
        if (pRes.ok) {
          const pData = (await pRes.json()) as {
            features?: Array<{
              geometry?: { coordinates?: [number, number] };
              properties?: { name?: string; city?: string; district?: string; country?: string };
            }>;
          };
          found = (pData.features || [])
            .map((f) => {
              const coords = f.geometry?.coordinates;
              const props = f.properties || {};
              const parts = [props.name, props.district, props.city, props.country].filter(Boolean);
              return coords && coords.length >= 2
                ? {
                    label: parts.join(', ') || q,
                    lat: Number(coords[1]),
                    lng: Number(coords[0]),
                  }
                : null;
            })
            .filter((x): x is SearchSuggestion => Boolean(x && Number.isFinite(x.lat) && Number.isFinite(x.lng)));
        }
      }

      if (!isMountedRef.current) return;
      if (found.length > 0) {
        jumpTo(found[0].lat, found[0].lng, found[0].label);
        if (found.length > 1) {
          setSuggestions(found);
        }
      } else {
        onToast('រកមិនឃើញទីតាំងនេះទេ! សាកវាយជាភាសាអង់គ្លេស ឬអូសផែនទី');
      }
    } catch {
      if (isMountedRef.current) {
        onToast('មិនអាចស្វែងរកទីតាំងបានទេ សូមអូសផែនទី!');
      }
    } finally {
      if (isMountedRef.current) setSearching(false);
    }
  };

  const handlePaste = async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // clipboard permission denied on some iOS browsers
    }
    if (text && text.trim()) {
      const cleaned = text.trim();
      setSearchQuery(cleaned);
      await runSearchOrResolve(cleaned);
    } else {
      onToast('សូមចុច Paste ក្នុងប្រអប់ស្វែងរកខាងឆ្វេង រួចចុច «រក»');
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
            className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl overflow-hidden shadow-2xl flex flex-col h-[92dvh] max-h-[780px]"
          >
            <div className="px-4 py-3.5 bg-[#0D4A3E] text-white flex justify-between items-center shrink-0">
              <div className="min-w-0 pr-2">
                <h3 className="font-bold text-sm truncate">
                  {purpose === 'shop'
                    ? isEn
                      ? 'Set Your Shop Location'
                      : 'កំណត់ទីតាំងហាងរបស់អ្នក'
                    : isEn
                      ? 'Choose Delivery Location'
                      : 'ជ្រើសរើសទីតាំងដឹកជញ្ជូន'}
                </h3>
                <p className="text-[11px] text-emerald-200 truncate">{gpsNote}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={isEn ? 'Close' : 'បិទ'}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center bg-white/15 rounded-full hover:bg-white/25 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative p-3 bg-slate-50 border-b border-slate-200 space-y-2 shrink-0">
              <div className="flex gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        runSearchOrResolve();
                      }
                    }}
                    placeholder={
                      isEn ? 'Search place or paste Google Maps link...' : 'វាយឈ្មោះតំបន់ ឬ Link Google Maps...'
                    }
                    className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-base sm:text-xs bg-white focus:outline-none focus:border-[#0D4A3E]"
                  />
                </div>
                <button
                  type="button"
                  disabled={searching}
                  onClick={() => runSearchOrResolve()}
                  className="bg-[#0D4A3E] disabled:opacity-60 text-white px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0"
                >
                  {searching ? '...' : isEn ? 'Search' : 'រក'}
                </button>
                <button
                  type="button"
                  onClick={handlePaste}
                  className="bg-amber-400 text-slate-900 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0"
                >
                  Paste
                </button>
              </div>

              {suggestions.length > 1 && (
                <div className="bg-white border border-slate-200 rounded-xl shadow-lg divide-y divide-slate-100 max-h-40 overflow-y-auto">
                  {suggestions.map((sug, idx) => (
                    <button
                      key={`${sug.lat}-${sug.lng}-${idx}`}
                      type="button"
                      onClick={() => jumpTo(sug.lat, sug.lng, sug.label)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-[#E8F2EF] flex items-center gap-2 transition-colors"
                    >
                      <MapPin className="w-3.5 h-3.5 text-[#0D4A3E] shrink-0" />
                      <span className="truncate font-medium text-slate-800">{sug.label}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-1.5 overflow-x-auto hide-scrollbar">
                {LANDMARKS.map((lm) => (
                  <button
                    key={lm.short}
                    type="button"
                    onClick={() => jumpTo(lm.lat, lm.lng, lm.label)}
                    className="text-[11px] bg-white border border-slate-200 hover:border-[#0D4A3E] px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors shrink-0"
                  >
                    {lm.short}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative flex-1 bg-slate-200 min-h-[240px]">
              <div ref={mapContainerRef} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
              <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full z-[450] flex flex-col items-center">
                <div className="bg-[#0D4A3E] text-white text-[10px] font-bold px-2.5 py-0.5 rounded-lg shadow mb-1 whitespace-nowrap">
                  {purpose === 'shop' ? (isEn ? 'Shop Pin' : 'ទីតាំងហាង') : isEn ? 'Your Pin' : 'ទីតាំងអ្នក'}
                </div>
                <MapPin className="w-8 h-8 text-[#0D4A3E] fill-amber-400 drop-shadow-md" />
              </div>

              <div className="absolute top-3 right-3 z-[400] flex gap-1 bg-white/95 p-1 rounded-xl shadow border border-slate-200/80">
                <button
                  type="button"
                  onClick={() => switchStyle('street')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                    mapStyle === 'street' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                  }`}
                >
                  {isEn ? 'Map' : 'ផែនទី'}
                </button>
                <button
                  type="button"
                  onClick={() => switchStyle('satellite')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                    mapStyle === 'satellite' ? 'bg-[#0D4A3E] text-white' : 'text-slate-700'
                  }`}
                >
                  {isEn ? 'Satellite' : 'ផ្កាយរណប'}
                </button>
              </div>

              {purpose === 'customer' && (
                <button
                  type="button"
                  onClick={() => jumpTo(shopSettings.lat, shopSettings.lng)}
                  className="absolute bottom-7 left-3 z-[400] bg-white/95 text-slate-800 font-bold text-[11px] px-2.5 py-2 rounded-xl shadow-md flex items-center gap-1 border border-slate-200"
                >
                  <Store className="w-3.5 h-3.5 text-amber-600" />
                  <span>{isEn ? 'Shop' : 'ទីតាំងហាង'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => detectUserGPS(true)}
                className="absolute bottom-6 right-3 z-[400] bg-white text-[#0D4A3E] font-bold text-xs px-3.5 py-2.5 rounded-xl shadow-lg flex items-center gap-1.5 border border-slate-200 active:scale-95 transition-transform"
              >
                <Crosshair className="w-4 h-4" />
                <span>{isEn ? 'Use My GPS' : 'ចាប់ទីតាំង GPS ខ្ញុំ'}</span>
              </button>
            </div>

            <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-white border-t border-slate-200 space-y-2.5 shrink-0">
              <div className="bg-[#E8F2EF] text-[#0D4A3E] p-3 rounded-2xl text-xs">
                <p className="font-bold truncate">{addressText}</p>
                <p className="text-[11px] font-mono-num mt-0.5">
                  {purpose === 'shop'
                    ? `${isEn ? 'Coords:' : 'កូអរដោនេ៖'} ${centerCoords.lat.toFixed(5)}, ${centerCoords.lng.toFixed(5)}`
                    : `${isEn ? 'Distance:' : 'ចម្ងាយពីហាង៖'} ${distKm.toFixed(2)} km · ${
                        isEn ? 'Delivery Fee:' : 'ថ្លៃដឹក៖'
                      } ${fee === 0 ? (isEn ? 'Free' : 'ឥតគិតថ្លៃ') : `$${fee.toFixed(2)}`}`}
                </p>
              </div>
              <button
                type="button"
                onClick={handleConfirm}
                className="w-full bg-[#0D4A3E] hover:bg-[#09352C] text-white font-bold py-3 rounded-2xl text-sm transition-colors"
              >
                {isEn ? 'Confirm This Location' : 'បញ្ជាក់ទីតាំងនេះ'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
