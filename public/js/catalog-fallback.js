// Offline metadata snapshot. It keeps the interface useful when the public
// catalog temporarily rate-limits the metadata relay. No streams or secrets
// are bundled here.
const PHIM4K_FILTER_METADATA = [
  [["H\u00e0nh \u0110\u1ed9ng", "Khoa h\u1ecdc vi\u1ec5n t\u01b0\u1edfng"], ["\u00c2u M\u1ef9"]],
  [["H\u00e0nh \u0110\u1ed9ng", "H\u00ecnh s\u1ef1"], ["\u00c2u M\u1ef9"]],
  [["H\u00e0i h\u01b0\u1edbc", "H\u00ecnh s\u1ef1"], ["\u00c2u M\u1ef9"]],
  [["Ho\u1ea1t h\u00ecnh", "H\u00e0nh \u0111\u1ed9ng"], ["Nh\u1eadt B\u1ea3n"]],
  [["Ho\u1ea1t h\u00ecnh", "C\u1ed5 trang"], ["Trung Qu\u1ed1c"]],
  [["Ho\u1ea1t h\u00ecnh", "Ch\u00ednh k\u1ecbch"], ["Nh\u1eadt B\u1ea3n"]],
  [["T\u00ecnh c\u1ea3m", "Ch\u00ednh k\u1ecbch"], ["H\u00e0n Qu\u1ed1c"]],
  [["T\u00ecnh c\u1ea3m", "H\u00e0i h\u01b0\u1edbc"], ["H\u00e0n Qu\u1ed1c"]],
];

window.PHIM4K_CATALOG_FALLBACK = Object.freeze([
  ["Chien Tranh Giua Cac Vi Sao: Maul", "chien-tranh-giua-cac-vi-sao-maul-chua-te-bong-toi", "Star Wars: Maul - Shadow Lord", "https://phimimg.com/uploads/movies/20260905/chien-tranh-giua-cac-vi-sao-maul-chua-te-bong-toi-poster.webp", "https://phimimg.com/uploads/movies/20260905/chien-tranh-giua-cac-vi-sao-maul-chua-te-bong-toi-thumb.webp", 2026],
  ["Quy Ong The Gioi Ngam (Phan 2)", "quy-ong-the-gioi-ngam-phan-2", "The Gentlemen (Season 2)", "https://phimimg.com/uploads/movies/20260905/quy-ong-the-gioi-ngam-phan-2-poster.webp", "https://phimimg.com/uploads/movies/20260905/quy-ong-the-gioi-ngam-phan-2-thumb.webp", 2026],
  ["Quy Ong The Gioi Ngam (Phan 1)", "quy-ong-the-gioi-ngam-phan-1", "The Gentlemen (Season 1)", "https://phimimg.com/uploads/movies/20260905/quy-ong-the-gioi-ngam-phan-1-poster.webp", "https://phimimg.com/upload/vod/20240307-1/73fe9704d483d8ed0d6d300e3000f8ba.jpg", 2024],
  ["Khai Giap Chan Truyen", "khai-giap-chan-truyen", "Yoroi-Shinden Samurai Troopers", "https://phimimg.com/upload/vod/20260116-1/e3b57ec33c4555307df7c16a441ba08c.jpg", "https://phimimg.com/upload/vod/20260116-1/ce2cc0cbfbbf8532c8728a38aafdba39.jpg", 2026],
  ["Son Hai Kinh: Thiet Lap Lai Trat Tu", "son-hai-kinh-thiet-lap-lai-trat-tu", "Threads of Fate", "https://phimimg.com/uploads/movies/20260719/son-hai-kinh-thiet-lap-lai-trat-tu-poster.webp", "https://phimimg.com/uploads/movies/20260719/son-hai-kinh-thiet-lap-lai-trat-tu-thumb.webp", 2026],
  ["Ve Xong Di, Roi Hay Chet!", "ve-xong-di-roi-hay-chet", "Draw This, Then Die!", "https://phimimg.com/upload/vod/20260705-1/e3b57ec33c4555307df7c16a441ba08c.jpg", "https://phimimg.com/upload/vod/20260705-1/ce2cc0cbfbbf8532c8728a38aafdba39.jpg", 2026],
  ["Ve Nen Giac Mo Ngay Cuoi", "ve-nen-giac-mo-ngay-cuoi", "In Love Forever The Series", "https://phimimg.com/upload/vod/20260620-1/4e75731d01ce9578582f65d9b21fb276.jpg", "https://phimimg.com/upload/vod/20260620-1/d61fcd20fba7e8b05fc0846bf1562be6.jpg", 2026],
  ["U Thi Ly Hon!", "u-thi-ly-hon", "OK! Let's Get Divorced", "https://phimimg.com/uploads/movies/20260821/u-thi-ly-hon-poster.webp", "https://phimimg.com/uploads/movies/20260821/u-thi-ly-hon-thumb.webp", 2026],
].map(([name, slug, origin_name, poster_url, thumb_url, year], index) => {
  const [genres, countries] = PHIM4K_FILTER_METADATA[index] || [[], []];
  return Object.freeze({
  name, slug, origin_name, poster_url, thumb_url, year,
  quality: "FHD", episode_current: "Full", lang: "Vietsub",
  content: "Thong tin chi tiet se duoc cap nhat khi nguon du lieu san sang.",
  category: genres.map((name) => ({ name })),
  country: countries.map((name) => ({ name })),
  });
}));
