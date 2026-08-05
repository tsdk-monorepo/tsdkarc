import { createApp } from "vue";
import "./globals.css";
import App, { queryClient } from "./App";
import { VueQueryPlugin } from "@tanstack/vue-query";

createApp(App).use(VueQueryPlugin, { queryClient }).mount("#app");
