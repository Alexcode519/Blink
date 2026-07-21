# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# React Native / Hermes JSI rely on JNI method names surviving obfuscation.
-keepclasseswithmembernames class * {
    native <methods>;
}

# Google ML Kit face detection loads its model/detector classes via reflection.
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_face_bundled** { *; }
-dontwarn com.google.mlkit.**

# Firebase Cloud Messaging
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

# Skia's native bridge is invoked by JNI method name.
-keep class com.shopify.reactnative.skia.** { *; }
