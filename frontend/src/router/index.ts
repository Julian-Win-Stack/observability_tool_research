import { createRouter, createWebHistory } from "vue-router";
import ResearchView from "../views/ResearchView.vue";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "research",
      component: ResearchView
    }
  ]
});

export default router;
