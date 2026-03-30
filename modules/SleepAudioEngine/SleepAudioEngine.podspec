require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'SleepAudioEngine'
  s.version        = package['version']
  s.summary        = 'Native AVAudioEngine sleep sound analysis module for Coco Sleep'
  s.homepage       = 'https://github.com/placeholder'
  s.license        = { :type => 'MIT' }
  s.authors        = { 'Coco Sleep' => 'dev@example.com' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.swift'
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'AVFoundation', 'Accelerate'
  s.swift_version  = '5.9'
end
