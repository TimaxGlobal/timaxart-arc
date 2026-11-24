v3.3 - video + changeable artwork link  (unzip over your timax-art-pool folder, overwrite when asked)

Changed:  src/ArtShare.sol            admin (Safe) can call setArtworkURI(); lockArtwork() freezes it forever
New:      script/5_SetArtworkLink.s.sol, update-artwork-link.ps1
Updated:  tools/add-painting.js       --video file-or-link (mp4/webm, ~20 MB), --video none removes it
          tools/build-paintings.js, tools/pin-painting.js (pins the video too), offer/index.html (video player), launch-painting.ps1

IMPORTANT: ArtShare changed, so only tokens launched with v3.3 can change their link. Not launched yet? Just use v3.3.
Add a video:      .\add-painting.ps1 --code ART001 --video "C:\clips\closeup.mp4"
Change link later: .\update-artwork-link.ps1 -Code ART001 [-Lock]
