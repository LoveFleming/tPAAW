import React, { useId } from "react";

/**
 * Icon component — inline SVG icons that render consistently on ALL platforms
 * (Mac, Windows, Linux). Replaces emoji which look different or broken on Linux.
 *
 * Usage: <Icon name="edit" size={16} /> or <Icon name="rocket" className="text-red-500" />
 */

// Heroicons (outline) paths — MIT licensed, clean 24x24 viewbox
const PATHS: Record<string, { path: string; viewBox?: string; fill?: boolean; stroke?: boolean; color?: string }> = {
    // Actions
    edit:      { path: "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" },
    trash:     { path: "M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" },
    plus:      { path: "M12 4.5v15m7.5-7.5h-15" },
    save:      { path: "M17 17H7.5A2.5 2.5 0 015 14.5v-9A2.5 2.5 0 017.5 3H12l5 5v6.5a2.5 2.5 0 01-2.5 2.5zM12 3v5h5" },
    restart:   { path: "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" },

    // Status / Indicators
    check:     { path: "M4.5 12.75l6 6 9-13.5", fill: false },
    cross:     { path: "M6 18L18 6M6 6l12 12" },
    star:      { path: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" },
    warning:   { path: "M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" },
    error:     { path: "M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" },
    info:      { path: "M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" },
    success:   { path: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },

    // Objects
    lock:      { path: "M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" },
    rocket:    { path: "M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" },
    clipboard: { path: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" },
    brain:     { path: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" },
    chat:      { path: "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" },
    lightning: { path: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
    document:  { path: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" },
    folder:    { path: "M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" },
    factory:   { path: "M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008H17.25V7.5zm0 3h.008v.008H17.25V10.5zm0 3h.008v.008H17.25V13.5z" },
    scroll:    { path: "M13.5 10.5V21M10.5 10.5V21M7.5 10.5V21M3.75 21h14.25a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25h-1.372c-.516 0-1.006.178-1.395.5l-1.083.864a2.25 2.25 0 01-1.395.5H3.75a2.25 2.25 0 00-2.25 2.25v8.25a2.25 2.25 0 002.25 2.25z" },
    ruler:     { path: "M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" },
    pin:       { path: "M15 10.5a3 3 0 11-6 0 3 3 0 016 0z M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" },
    inbox:     { path: "M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-18.966 0V6.75a2.25 2.25 0 012.25-2.25h13.5a2.25 2.25 0 012.25 2.25v6.75" },
    robot:     { path: "M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v9a2.25 2.25 0 002.25 2.25zm.75-8.25h.008v.008H8.25V9.75zm0 3h.008v.008H8.25V12.75zm0 3h.008v.008H8.25V15.75zm7.5-6h.008v.008h-.008V9.75zm0 3h.008v.008h-.008V12.75zm0 3h.008v.008h-.008V15.75z" },
    gear:      { path: "M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z" },
    thinking:  { path: "M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" },
    expand:    { path: "M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" },
    contract:  { path: "M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" },
    clock:     { path: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" },
    "chart-bar": { path: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z", color: "#3B82F6" },
    keyboard:  { path: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" },

    // Nature (theme icons)
    // Theme icons — colorful filled SVGs
    sun:       { path: "THEME_SUN", fill: true, stroke: false, color: "#FBBF24" },
    sunny:     { path: "THEME_SUN", fill: true, stroke: false, color: "#FBBF24" },
    "cloud-sun": { path: "THEME_CLOUD_SUN", fill: true, stroke: false, color: "#60A5FA" },
    sky:       { path: "THEME_CLOUD_SUN", fill: true, stroke: false, color: "#60A5FA" },
    "calm-anger": { path: "THEM_CALM_ANGER", fill: true, stroke: false, color: "#A78BFA" },
    "calm-anxiety": { path: "THEME_CALM_ANXIETY", fill: true, stroke: false, color: "#6EE7B7" },
    "calm-resignation": { path: "THEME_CALM_RESIGNATION", fill: true, stroke: false, color: "#FB923C" },
    "calm-tension": { path: "THEME_CALM_TENSION", fill: true, stroke: false, color: "#34D399" },
    "calm-exhaustion": { path: "THEME_CALM_EXHAUSTION", fill: true, stroke: false, color: "#D97706" },
    "boost-creative": { path: "THEME_BOOST_CREATIVE", fill: true, stroke: false, color: "#A78BFA" },

    // CLI brand dots (solid circles)
    "dot-purple": { path: "M12 12m-8 0a8 8 0 1016 0 8 8 0 00-16 0z", viewBox: "0 0 24 24", fill: true, stroke: false, color: "#8B5CF6" },
    "dot-orange": { path: "M12 12m-8 0a8 8 0 1016 0 8 8 0 00-16 0z", viewBox: "0 0 24 24", fill: true, stroke: false, color: "#F97316" },
    "dot-blue":   { path: "M12 12m-8 0a8 8 0 1016 0 8 8 0 00-16 0z", viewBox: "0 0 24 24", fill: true, stroke: false, color: "#3B82F6" },

    // File type icons (replacing emoji)
    "file-json":   { path: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z", color: "#F59E0B" },
    "file-md":     { path: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z", color: "#3B82F6" },
    "file-code":   { path: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5", color: "#8B5CF6" },
    "file-css":    { path: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z", color: "#EC4899" },
    "file-html":   { path: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z", color: "#F97316" },
    "file-py":     { path: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5", color: "#3B82F6" },
    "file-java":   { path: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z", color: "#EF4444" },
    "file-go":     { path: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5", color: "#06B6D4" },
    "file-rs":     { path: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5", color: "#F97316" },
    "file-sh":     { path: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z", color: "#10B981" },
    "file-txt":    { path: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z", color: "#6B7280" },
    "file-lock":   { path: "M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z", color: "#6B7280" },
    "file-default":{ path: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z", color: "#9CA3AF" },

    // UI emoji replacements
    "nav-scroll":  { path: "M13.5 10.5V21M10.5 10.5V21M7.5 10.5V21M3.75 21h14.25a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25h-1.372c-.516 0-1.006.178-1.395.5l-1.083.864a2.25 2.25 0 01-1.395.5H3.75a2.25 2.25 0 00-2.25 2.25v8.25a2.25 2.25 0 002.25 2.25z", color: "#D97706" },
    "nav-ruler":   { path: "M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15", color: "#6366F1" },
    "nav-crew":    { path: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z", color: "#8B5CF6" },

    // Misc
    flask:     { path: "M19.5 12c0 1.232-.046 2.453-.138 3.662a4.006 4.006 0 01-3.7 3.7 48.678 48.678 0 01-7.324 0 4.006 4.006 0 01-3.7-3.7 48.57 48.57 0 010-7.324 4.006 4.006 0 013.7-3.7 48.57 48.57 0 017.324 0 4.006 4.006 0 013.7 3.7c.092 1.21.138 2.43.138 3.662zM10.5 2.25v6.75a.75.75 0 01-.3.6l-1.5 1.125a.75.75 0 00-.3.6v1.5a.75.75 0 00.75.75h6a.75.75 0 00.75-.75v-1.5a.75.75 0 00-.3-.6l-1.5-1.125a.75.75 0 01-.3-.6V2.25", color: "#8B5CF6" },
    arrow:     { path: "M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" },
    search:    { path: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" },
    code:      { path: "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" },
    shield:    { path: "M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" },
    plan:      { path: "M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" },
};

interface IconProps {
    name: keyof typeof PATHS | string;
    size?: number;
    className?: string;
    style?: React.CSSProperties;
}

// Colorful theme icon SVGs (inline JSX for gradient fills)
const THEME_ICONS: Record<string, (size: number, uid: string) => React.ReactElement> = {
    THEME_SUN: (s, uid) => (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id={`${uid}-sun`} cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#FDE68A" /><stop offset="60%" stopColor="#FBBF24" /><stop offset="100%" stopColor="#F59E0B" /></radialGradient></defs>
            <circle cx="24" cy="24" r="10" fill={`url(#${uid}-sun)`} />
            {[0,45,90,135,180,225,270,315].map(a => {
                const rad = a * Math.PI / 180;
                const x1 = 24 + Math.cos(rad) * 13; const y1 = 24 + Math.sin(rad) * 13;
                const x2 = 24 + Math.cos(rad) * 18; const y2 = 24 + Math.sin(rad) * 18;
                return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FBBF24" strokeWidth={2.5} strokeLinecap="round" />;
            })}
        </svg>
    ),
    THEME_CLOUD_SUN: (s, uid) => (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id={`${uid}-cs`} cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#FDE68A" /><stop offset="100%" stopColor="#FBBF24" /></radialGradient></defs>
            <circle cx="34" cy="16" r="7" fill={`url(#${uid}-cs)`} />
            {[0,60,120,180,240,300].map(a => {
                const rad = a * Math.PI / 180;
                const x1 = 34 + Math.cos(rad) * 9; const y1 = 16 + Math.sin(rad) * 9;
                const x2 = 34 + Math.cos(rad) * 12; const y2 = 16 + Math.sin(rad) * 12;
                return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FBBF24" strokeWidth={2} strokeLinecap="round" />;
            })}
            <path d="M8 32a8 8 0 0113.5-5.8A6 6 0 0130 30h2a5 5 0 010 10H12a7 7 0 01-4-8z" fill="#93C5FD" />
            <path d="M10 34a6 6 0 0110-4.4A4.5 4.5 0 0128 32h1.5a3.5 3.5 0 010 7H14a5 5 0 01-4-5z" fill="#BFDBFE" />
        </svg>
    ),
    THEM_CALM_ANGER: (s, uid) => (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id={`${uid}-lav`} cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#DDD6FE" /><stop offset="50%" stopColor="#C4B5FD" /><stop offset="100%" stopColor="#8B5CF6" /></radialGradient></defs>
            <circle cx="24" cy="24" r="20" fill={`url(#${uid}-lav)`} />
            {/* Lotus flower — symbol of calm */}
            {[0,60,120,180,240,300].map((a, i) => {
                const rad = a * Math.PI / 180;
                const cx = 24 + Math.cos(rad) * 6;
                const cy = 24 + Math.sin(rad) * 6;
                return <ellipse key={i} cx={cx} cy={cy} rx="5" ry="9" transform={`rotate(${a} ${cx} ${cy})`} fill="#DDD6FE" opacity="0.8" />;
            })}
            <circle cx="24" cy="24" r="4" fill="#7C3AED" />
        </svg>
    ),
    THEME_CALM_ANXIETY: (s, uid) => (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id={`${uid}-sage`} cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#D1FAE5" /><stop offset="50%" stopColor="#6EE7B7" /><stop offset="100%" stopColor="#059669" /></radialGradient></defs>
            <circle cx="24" cy="24" r="20" fill={`url(#${uid}-sage)`} />
            {/* Leaf — nature, grounding */}
            <path d="M24 10c0 0-12 8-12 18c0 6 5 10 12 10c7 0 12-4 12-10C36 18 24 10 24 10z" fill="#34D399" opacity="0.9" />
            <path d="M24 14v18M24 20l-5 4M24 24l5 4M24 28l-4 3" stroke="#059669" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
    ),
    THEME_CALM_RESIGNATION: (s, uid) => (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id={`${uid}-coral`} cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#FED7AA" /><stop offset="50%" stopColor="#FB923C" /><stop offset="100%" stopColor="#EA580C" /></radialGradient></defs>
            <circle cx="24" cy="24" r="20" fill={`url(#${uid}-coral)`} />
            {/* Warm heart — comfort, embrace */}
            <path d="M24 36s-12-7.5-12-15c0-4 3-7 6.5-7c2.5 0 4.5 1.5 5.5 3.5c1-2 3-3.5 5.5-3.5c3.5 0 6.5 3 6.5 7C36 28.5 24 36 24 36z" fill="#FDBA74" opacity="0.9" />
            <path d="M24 32s-8-5-8-10c0-2.5 2-4.5 4-4.5c1.5 0 3 1 4 2.5c1-1.5 2.5-2.5 4-2.5c2 0 4 2 4 4.5C32 27 24 32 24 32z" fill="#FED7AA" opacity="0.8" />
        </svg>
    ),
    THEME_CALM_TENSION: (s, uid) => (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id={`${uid}-forest`} cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#D1FAE5" /><stop offset="50%" stopColor="#34D399" /><stop offset="100%" stopColor="#059669" /></radialGradient></defs>
            <circle cx="24" cy="24" r="20" fill={`url(#${uid}-forest)`} />
            {/* Pine tree — nature, grounding */}
            <polygon points="24,8 18,22 21,22 16,32 31,32 26,22 30,22" fill="#065F46" opacity="0.9" />
            <rect x="22" y="32" width="4" height="6" fill="#065F46" opacity="0.8" />
        </svg>
    ),
    THEME_CALM_EXHAUSTION: (s, uid) => (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id={`${uid}-warm`} cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#FEF3C7" /><stop offset="50%" stopColor="#D97706" /><stop offset="100%" stopColor="#92400E" /></radialGradient></defs>
            <circle cx="24" cy="24" r="20" fill={`url(#${uid}-warm)`} />
            {/* Coffee cup — warmth, comfort */}
            <rect x="14" y="18" width="16" height="14" rx="2" fill="#FDE68A" opacity="0.9" />
            <path d="M30 22h2a4 4 0 010 8h-2" stroke="#FDE68A" strokeWidth="2" fill="none" opacity="0.8" />
            <path d="M20 15c0-2 1-3 2-4" stroke="#FDE68A" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
            <path d="M24 14c0-2 1-3 2-4" stroke="#FDE68A" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
        </svg>
    ),
    THEME_BOOST_CREATIVE: (s, uid) => (
        <svg width={s} height={s} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs><radialGradient id={`${uid}-purple`} cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#EDE9FE" /><stop offset="50%" stopColor="#A78BFA" /><stop offset="100%" stopColor="#7C3AED" /></radialGradient></defs>
            <circle cx="24" cy="24" r="20" fill={`url(#${uid}-purple)`} />
            {/* Crystal ball — inspiration, magic */}
            <ellipse cx="24" cy="22" rx="10" ry="10" fill="#DDD6FE" opacity="0.7" />
            <ellipse cx="24" cy="22" rx="7" ry="7" fill="#C4B5FD" opacity="0.5" />
            <path d="M18 34h12" stroke="#DDD6FE" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
            <path d="M20 36h8" stroke="#DDD6FE" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
            {/* Sparkle */}
            <circle cx="20" cy="18" r="1.5" fill="white" opacity="0.9" />
        </svg>
    ),
};

export default function Icon({ name, size = 16, className = "", style }: IconProps) {
    const uid = useId();

    // Check for colorful theme icons first
    const icon = PATHS[name];
    if (!icon) {
        // Fallback: render as text if unknown
        return <span className={className} style={{ fontSize: size, lineHeight: 1, ...style }}>{name}</span>;
    }

    // If it's a theme icon, render the colorful version with unique gradient IDs
    const themeRenderer = THEME_ICONS[icon.path];
    if (themeRenderer) {
        return <span className={`inline-block shrink-0 ${className}`} style={{ verticalAlign: "middle", ...style }}>{themeRenderer(size, uid)}</span>;
    }

    const vb = icon.viewBox || "0 0 24 24";
    const shouldFill = icon.fill !== false;
    const shouldStroke = icon.stroke !== false;
    const defaultColor = icon.color || "currentColor";

    return (
        <svg
            width={size}
            height={size}
            viewBox={vb}
            fill={shouldFill ? (icon.color || "none") : "none"}
            stroke={shouldStroke ? defaultColor : "none"}
            strokeWidth={shouldStroke ? 1.5 : 0}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`inline-block shrink-0 ${className}`}
            style={{ verticalAlign: "middle", ...style }}
            aria-hidden="true"
        >
            <path d={icon.path} />
        </svg>
    );
}

// Helper: returns a small inline <Icon> + text combo for buttons/labels
export function IconLabel({ name, children, size = 14, gap = 4, className = "" }: {
    name: keyof typeof PATHS | string;
    children: React.ReactNode;
    size?: number;
    gap?: number;
    className?: string;
}) {
    return (
        <span className={`inline-flex items-center ${className}`} style={{ gap }}>
            <Icon name={name} size={size} />
            {children}
        </span>
    );
}

// CLI brand icon helper
export function CliIcon({ cli, size = 14 }: { cli: string; size?: number }) {
    const map: Record<string, string> = {
        qwen: "dot-purple",
        claude: "dot-orange",
        opencode: "dot-blue",
    };
    return <Icon name={map[cli] || "dot-purple"} size={size} />;
}

// Approval mode icon helper
export function ApprovalIcon({ mode, size = 14 }: { mode: string; size?: number }) {
    const map: Record<string, string> = {
        default: "lock",
        "auto-edit": "edit",
        yolo: "rocket",
        plan: "plan",
    };
    return <Icon name={map[mode] || "lock"} size={size} />;
}

// File type icon helper — replaces emoji file icons on all platforms
const FILE_ICON_MAP: Record<string, string> = {
    json: "file-json", md: "file-md", css: "file-css", html: "file-html",
    py: "file-py", java: "file-java", go: "file-go", rs: "file-rs",
    ts: "file-code", tsx: "file-code", js: "file-code", jsx: "file-code",
    sh: "file-sh", txt: "file-txt", lock: "file-lock",
};

export function FileIcon({ ext, size = 14, className = "" }: { ext: string; size?: number; className?: string }) {
    return <Icon name={FILE_ICON_MAP[ext] || "file-default"} size={size} className={className} />;
}
