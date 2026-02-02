<template>
  <v-app>
    <v-app-bar flat density="confortable" color="red-lighten-1">

      <v-img src="/assets/PicJoyAnimated.gif" height="60" width="auto" contain></v-img>PicJoy
    </v-app-bar>
    <v-main>
      <v-container fluid class="content-area">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
</script>

<style>

  html,
  body,
  #app,

  .v-app {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: black;
  }

  .v-main {
    background: linear-gradient(135deg,
        #28bcd7 0%,
        #5de0ff 15%,
        #2b4fad 30%,
        #8a4fae 50%,
        #e4498f 70%,
        #f9a64a 85%,
        #f7dd4a 100%);
    min-height: 100dvh !important;
    overflow-y: auto;
  }
</style>
