import { memo } from "react";
import type { LibraryArtist } from "../lib/libraryArtists";

// Original vector line drawings, with a few distinctive portrait details.
export const ArtistAvatar = memo(function ArtistAvatar({artist}:{artist:LibraryArtist}) {
  const style=artist.portrait;
  const tint=[...artist.id].reduce((sum,c)=>sum+c.charCodeAt(0),0)%5;
  return <svg className={`artist-avatar artist-tint-${tint}`} viewBox="0 0 160 160" aria-hidden="true" focusable="false">
    <circle className="artist-avatar-disc" cx="80" cy="80" r="76" />
    <g className="artist-avatar-lines" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4">
      {style==="music" ? <>
        <path d="M48 97V51l64-13v45M48 63l64-13"/><ellipse cx="37" cy="100" rx="12" ry="9"/><ellipse cx="101" cy="86" rx="12" ry="9"/><path d="M40 126h79M53 137h55"/>
      </> : style==="duo" ? <>
        <path d="M20 134c2-20 14-25 30-25s28 5 30 25M83 134c2-20 14-25 30-25s28 5 30 25M32 61c0-26 36-26 36 0v23c0 26-36 26-36 0ZM94 61c0-27 36-27 36 0v23c0 26-36 26-36 0Z"/>
        <path d="M32 59l7-18 12-3 17 18M93 59l-3-15 11-13 18 2 16 17M40 69h4m10 0h4m43 0h4m10 0h4M45 86l7 2m55-2 7 2"/>
      </> : <>
        {style==="long"||style==="ponytail" ? <path d="M52 111c-15-20-16-55-8-72 10-27 59-25 71 1 9 18 7 52-5 72M50 57c3-37 56-37 62 0"/> : null}
        {style==="bob" ? <path d="M47 101c-13-10-12-53-1-66 17-17 57-14 66 6 7 15 9 47 0 61l-11-5M48 52c12 1 28-8 37-17 7 12 17 17 26 19"/> : null}
        <path d="M52 59v24c0 19 12 30 28 30s28-11 28-30V59M49 65c-12-2-11 20 3 21M111 65c12-2 11 20-3 21M66 109v14m28-14v14M31 140c4-22 20-27 35-27l14 13 14-13c15 0 31 5 35 27"/>
        {style==="cap" ? <><path d="M43 54c0-19 14-31 37-31 22 0 36 12 36 28M38 55c25-11 49-10 80 0l-22 8-20-5-29 2M66 31l-6 14m27-18 2 17"/><path d="M67 102c5 4 21 4 26-1"/></> : null}
        {style==="fringe" ? <path d="M47 62c-13-34 9-39 31-38 31-7 43 14 34 37l-9-16-7 13-8-13-14 15-2-18-16 14-1-13Z"/> : null}
        {style==="short" ? <path d="M47 63c-7-30 10-41 31-41 30-6 43 13 35 40l-9-23-23 8-11-7-16 16"/> : null}
        {style==="glasses" ? <><path d="M48 59c-4-24 13-34 30-34 22-3 37 10 34 34M54 70h21v14H54Zm31 0h21v14H85Zm-10 7h10M56 45l14-7m22 1 11 6"/><path d="M48 71l6 5m52 0 6-5"/></> : <path d="M64 73h6m20 0h6"/>}
        {style==="curly" ? <path d="M47 60c-16-4-13-18-4-22-6-12 9-18 18-15 0-13 18-13 23-7 11-9 25 0 23 10 14-1 24 16 15 23l-7 12M55 40c0-10 13-12 19-5 1-9 19-9 21 0 10-5 17 1 17 10"/> : null}
        {style==="classical" ? <><path d="M51 65c-8-12-15-2-17-14-3-13 9-11 9-20 0-14 16-8 23-16 11-9 20 1 28 0 17-2 18 13 26 18 16 15-1 19-8 32M48 41l14-10m39 0 12 11M56 132l-8 9m56-9 8 9M69 115l11 22 11-22M75 127h10"/></> : null}
        {style==="ponytail" ? <path d="M111 35c18-10 32 2 23 18-5 11-6 31 3 46-18-6-26-17-19-39M50 51c19-1 42-13 48-20"/> : null}
        {style==="long" ? <path d="M50 53l17-16 5 14 14-14 6 12 14-5M41 90l-3 25m81-24 3 23"/> : null}
        <path d="M80 77l-3 12h7M71 97q9 5 18 0"/>
      </>}
    </g>
  </svg>;
});
