import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/:id/:encodedBridgeServerAddress",
    name: "home",
    component: () => import("../views/HomeView.vue"),
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});
