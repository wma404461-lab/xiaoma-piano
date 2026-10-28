import {useEffect,useState} from "react";
import type {Song} from "../types";
import {offlineState,setOfflinePinned} from "../lib/offlineScores";
import {useI18n} from "../lib/i18n";
export function OfflineSongControl({song}:{song:Song}) {
  const {locale}=useI18n(),en=locale==="en";
  const [state,setState]=useState({stored:false,ready:false,manual:false,automatic:false});
  const [error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;const refresh=()=>{void offlineState(song.id).then(value=>{if(active)setState(value);}).catch(()=>{});};refresh();window.addEventListener("xiaoma-offline-scores",refresh);return()=>{active=false;window.removeEventListener("xiaoma-offline-scores",refresh);};},[song.id]);
  return <span className="offline-song-control">
    <button type="button" disabled={busy} aria-pressed={state.manual} title={en?"Your 5 most-practiced scores stay offline automatically. Other temporary scores are limited to 16 MB.":"Your 5 most-practiced scores stay offline automatically. Other temporary scores are limited to 16 MB."} onClick={async()=>{setBusy(true);setError("");try{await setOfflinePinned(song,!state.manual);}catch(error){setError((error as Error).message);}finally{setBusy(false);}}}>
      {busy?(en?"Saving…":"Saving…"):state.manual?(en?"Unpin offline":"Unpin offline"):en?"Keep offline":"Keep offline"}
    </button>
    {state.stored&&<small>{state.ready?(state.manual?(en?"Pinned · offline ready":"Pinned · offline ready"):state.automatic?(en?"Frequent · offline ready":"Frequent · offline ready"):en?"Offline ready":"Offline ready"):en?"Score saved · audio on demand":"Score saved · audio on demand"}</small>}
    {error&&<small role="alert">{error}</small>}
  </span>;
}
