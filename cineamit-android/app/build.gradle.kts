import java.util.Locale
import java.util.Properties
import java.security.MessageDigest

plugins {
    id("com.android.application")
}

// CINE_AD_CONFIG_BEGIN: pure Unity-only resolver, exercised by isolated tests.
fun resolveCineAdsConfig(input: Map<String, Any?>): Map<String, String> {
    fun raw(name: String): String? = input[name]?.toString()?.trim()
    fun bool(name: String): String = when (raw(name)?.lowercase(Locale.ROOT)) {
        "true" -> "true"
        "false" -> "false"
        else -> throw GradleException("$name must be explicitly true or false, without quotes or inline comments. Value not printed.")
    }
    val result = linkedMapOf("UNITY_ENABLED" to bool("UNITY_ENABLED"), "UNITY_TEST_MODE" to bool("UNITY_TEST_MODE"))
    for (name in listOf("UNITY_GAME_ID", "UNITY_BANNER_PLACEMENT", "UNITY_INTERSTITIAL_PLACEMENT", "UNITY_REWARDED_PLACEMENT")) {
        val value = raw(name) ?: ""
        val pattern = if (name == "UNITY_GAME_ID") "[1-9][0-9]{3,11}" else "[A-Za-z0-9_-]{1,60}"
        if ((result["UNITY_ENABLED"] == "true" || value.isNotEmpty()) && !Regex(pattern).matches(value))
            throw GradleException("$name must be a valid direct Unity identifier. Value not printed.")
        result[name] = value
    }
    val canonical = result.entries.joinToString("\n") { "${it.key}=${it.value}" }
    result["UNITY_CONFIG_FINGERPRINT"] = MessageDigest.getInstance("SHA-256")
        .digest(canonical.toByteArray(Charsets.UTF_8)).take(6).joinToString("") { "%02x".format(it.toInt() and 255) }
    return result
}
fun validateCineAdDeclarations(sources: Map<String, Map<String, String>>, explicitKeys: Set<String>) {
    for (name in sources.values.flatMap { it.keys }.toSet()) {
        if (name in explicitKeys) continue
        val declared = sources.filterValues { it.containsKey(name) }
        val values = declared.values.map {
            val value = it.getValue(name).trim()
            if (name in listOf("UNITY_ENABLED", "UNITY_TEST_MODE")) value.lowercase(Locale.ROOT) else value
        }.toSet()
        if (values.size > 1) throw GradleException("Conflicting $name declarations in " + declared.keys.joinToString(", ") +
            ". Align/remove duplicates or deliberately override with -P$name=... . Values not printed.")
    }
}
// CINE_AD_CONFIG_END

fun q(s: String): String = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val cineAdPropertyNames = listOf("UNITY_ENABLED", "UNITY_TEST_MODE", "UNITY_GAME_ID",
    "UNITY_BANNER_PLACEMENT", "UNITY_INTERSTITIAL_PLACEMENT", "UNITY_REWARDED_PLACEMENT")
fun cineAdFileProperties(file: File): Map<String, String> {
    val properties = Properties()
    if (file.isFile) file.inputStream().use { properties.load(it) }
    return cineAdPropertyNames.filter { properties.containsKey(it) }.associateWith { properties.getProperty(it) }
}
val cineAdDeclarations = linkedMapOf(
    "project file" to cineAdFileProperties(rootProject.file("gradle.properties")),
    "Gradle-user-home file" to cineAdFileProperties(gradle.gradleUserHomeDir.resolve("gradle.properties")),
    "system-property" to cineAdPropertyNames.mapNotNull { n -> System.getProperty("org.gradle.project.$n")?.let { n to it } }.toMap(),
    "environment" to cineAdPropertyNames.mapNotNull { n -> System.getenv("ORG_GRADLE_PROJECT_$n")?.let { n to it } }.toMap()
)
validateCineAdDeclarations(cineAdDeclarations, gradle.startParameter.projectProperties.keys)
val cineAds = resolveCineAdsConfig(cineAdPropertyNames.associateWith { project.findProperty(it) })

android {
    namespace = "in.cineamit.app"
    lint {
        // Framework ImageView/ImageButton under android.app.Activity, minSdk24.
        // app:tint needs AppCompat inflation and would silently lose these tints.
        disable += "UseAppTint"
    }
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "in.cineamit.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 75
        versionName = "1.0.75"
        buildConfigField("String", "DEFAULT_BASE_URL", "\"https://cineamit.qzz.io\"")
        buildConfigField("String", "UNITY_CONFIG_FINGERPRINT", q(cineAds.getValue("UNITY_CONFIG_FINGERPRINT")))
        for (name in listOf("UNITY_ENABLED", "UNITY_TEST_MODE")) buildConfigField("boolean", name, cineAds.getValue(name))
        for (name in listOf("UNITY_GAME_ID", "UNITY_BANNER_PLACEMENT", "UNITY_INTERSTITIAL_PLACEMENT", "UNITY_REWARDED_PLACEMENT"))
            buildConfigField("String", name, q(cineAds.getValue(name)))
        ndk {
            abiFilters += listOf("armeabi-v7a", "arm64-v8a", "x86_64")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = true
    }
    packaging {
        jniLibs {
            // Keep the universal APK below the existing 90-MB updater cap,
            // including old installed clients. 64-bit ELF LOAD alignment is verified
            // independently; compressed libraries are extracted by Android.
            useLegacyPackaging = true
            pickFirsts += listOf("**/libc++_shared.so")
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.core:core:1.13.1")
    implementation("androidx.fragment:fragment:1.8.5")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.activity:activity:1.9.3")
    implementation("androidx.constraintlayout:constraintlayout:2.2.0")
    implementation("androidx.coordinatorlayout:coordinatorlayout:1.2.0")
    implementation("androidx.viewpager:viewpager:1.1.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.cardview:cardview:1.0.0")
    implementation("com.github.bumptech.glide:glide:4.16.0")
    implementation("com.caverock:androidsvg-aar:1.4")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-urlconnection:4.12.0")
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.4.1")
    implementation("androidx.media3:media3-exoplayer-dash:1.4.1")
    implementation("androidx.media3:media3-exoplayer-rtsp:1.4.1")
    implementation("androidx.media3:media3-exoplayer-smoothstreaming:1.4.1")
    implementation("androidx.media3:media3-ui:1.4.1")
    implementation("androidx.media3:media3-datasource-okhttp:1.4.1")
    implementation("org.videolan.android:libvlc-all:3.7.7")
    // Single direct Unity Ads provider; no mediation SDK.
    implementation("com.unity3d.ads:unity-ads:4.21.0")
}

// Safe diagnostics: no identifiers or project properties are printed.
tasks.register("printAdsConfig") {
    group = "verification"
    description = "Shows Unity-only mode and fingerprint without printing identifiers."
    doLast {
        println("CineAmit 1.0.74: strategy=Unity-only-direct")
        println("UNITY_ENABLED=" + cineAds.getValue("UNITY_ENABLED") + "; UNITY_TEST_MODE=" + cineAds.getValue("UNITY_TEST_MODE"))
        println("UNITY_CONFIG_FINGERPRINT=" + cineAds.getValue("UNITY_CONFIG_FINGERPRINT"))
        println("privacy=contextual-only; no startup popup; personalized consent never granted")
        for (name in cineAdPropertyNames) {
            val hints = mutableListOf<String>()
            if (gradle.startParameter.projectProperties.containsKey(name)) hints.add("command-line -P")
            for ((source, values) in cineAdDeclarations) if (values.containsKey(name)) hints.add(source)
            if (hints.isNotEmpty()) println(name + " declared in: " + hints.joinToString(", "))
        }
        println("Resolved mode/fingerprint are authoritative. Dashboard forced testing is separate.")
    }
}
