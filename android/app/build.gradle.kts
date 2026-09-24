import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The app shares its version with the Unity package.
@Suppress("UNCHECKED_CAST")
val packageJson = JsonSlurper().parse(file("../../packages/com.livework.unity/package.json")) as Map<String, Any>
val appVersion = packageJson["version"] as String
val appVersionCode = appVersion.substringBefore('-').split('.').map { it.toInt() }
    .let { (major, minor, patch) -> major * 10000 + minor * 100 + patch }

// Release signing comes from environment variables (CI) or keystore.properties (local).
val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun signingValue(env: String, key: String): String? = System.getenv(env) ?: keystoreProperties.getProperty(key)
val releaseStoreFile = signingValue("LIVEWORK_KEYSTORE_FILE", "storeFile")

android {
    namespace = "com.livework.client"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.livework.client"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        if (releaseStoreFile != null) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile)
                storePassword = signingValue("LIVEWORK_KEYSTORE_PASSWORD", "storePassword")
                keyAlias = signingValue("LIVEWORK_KEY_ALIAS", "keyAlias")
                keyPassword = signingValue("LIVEWORK_KEY_PASSWORD", "keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

base {
    archivesName.set("LiveWork-$appVersion")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // QR scanning with the camera; works without Google Play services.
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
}
