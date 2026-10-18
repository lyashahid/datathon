`rtl-vessels.json` is the byte-for-byte RTL / MTCC public vessel route response
retrieved on 11 October 2026 from
<https://bo.rtl.mv:4455/maldives/api/booking/v1/vessel/routedetails>.

SHA-256: `1d7c4b61b8fb4ef65791720839fa7c6f74332bc464cdd2424c4bc68ac3d0285c`.
Its source receipt is `rtl-vessel-service-check` in
`data/public/operations/source-manifest.json`. The sea ingestion tests use this
small frozen response to check exact route endpoint identities, coordinates, and
source checksum validation without an ignored local archive or a network call.
The fixture preserves the original response, including fields not used by the
terminal transformation. It does not establish arrival times or current service.

Public operator data; an explicit reuse licence was not stated by the publisher.
